import { resolveCacheMinTokens } from "./cache-profile.js";
import type { Encoder } from "./encoder.js";
import { resolveEncoder } from "./encoder.js";
import {
  type PricingOverride,
  type VolumeOptions,
  computeCost,
  resolvePricing,
} from "./pricing.js";
import type { AnalysisContext, Rule } from "./rule.js";
import { builtinRules } from "./rules/index.js";
import { findJsonRegions } from "./services/json-regions.js";
import { buildRepeatedSubstringIndex } from "./services/repeated-substring.js";
import type {
  AnalysisInput,
  ContentPart,
  Finding,
  InputRef,
  Message,
  Money,
  Slot,
  TokenView,
} from "./types.js";

export interface TokenizeOptions {
  model: string;
}

export function tokenize(text: string, options: TokenizeOptions): TokenView {
  return resolveEncoder(options.model).tokenize(text);
}

export interface AnalyzeOptions {
  model: string;
  /** file path this input came from, if any; surfaced on every Finding.loc.input.path */
  path?: string;
  /** rules to run; defaults to every builtin rule. Pass [] to only tokenize with no findings */
  rules?: readonly Rule[];
  /** whether rules that can autofix should attach a Finding.fix; defaults to true */
  autofix?: boolean;
  /** declared total token budget, used by the budget-exceeded rule */
  budget?: number;
  /** previously recorded token count, used by the baseline-regression rule */
  baseline?: number;
  /** bypasses resolveEncoder(model) with a specific Encoder instance, e.g. a locally-calibrated one */
  encoder?: Encoder;
  /** request volume, used to project Finding.cost.atVolume when pricing data exists for the model */
  volume?: VolumeOptions;
  /** per-model price overrides, keyed by exact model id; see Config.pricing.overrides */
  pricingOverrides?: Record<string, PricingOverride>;
}

export interface ApplyFixesOptions {
  ruleIds?: string[];
}

export interface Report {
  summary: {
    totalTokens: number;
    staticTokens: number;
    dynamicBudget: number;
    totalWasteTokens: number;
    /** sums priced region maxima and zero-savings findings; undefined when none carries pricing data */
    cost?: { perCall: Money; per1000Calls: Money; atVolume?: Money };
  };
  findings: Finding[];
  byRule: Record<string, Finding[]>;
  /** returns the input with autofixable findings applied; pure, never writes anything */
  applyFixes(options?: ApplyFixesOptions): string;
}

interface Normalized {
  text: string;
  inputRef: InputRef;
  messages?: Message[];
  slots: Slot[];
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map(partText).join("");
}

function partText(part: ContentPart): string {
  return "text" in part && typeof part.text === "string" ? part.text : "";
}

// joins a list of text blocks with "\n", exactly like the plain .join("\n")/.filter(Boolean)
// this replaces elsewhere in this function, but also rebases each block's own slots (if any)
// by its start offset in the joined text, so a dyn()-marked span inside one message of a
// Message[]/Payload input gets a real position in the final ctx.text, not just in isolation.
// filterEmpty matches .filter(Boolean)'s behavior (used by the payload branch only): a falsy
// block is skipped entirely, including its separator, not joined as an empty string.
function joinWithSlots(
  blocks: (string | undefined)[],
  slotsByBlock: (Slot[] | undefined)[],
  filterEmpty: boolean,
): { text: string; slots: Slot[] } {
  let text = "";
  const slots: Slot[] = [];
  let first = true;
  blocks.forEach((block, i) => {
    if (filterEmpty && !block) return;
    if (!first) text += "\n";
    first = false;
    const start = text.length;
    text += block ?? "";
    for (const slot of slotsByBlock[i] ?? []) {
      slots.push({ ...slot, range: [start + slot.range[0], start + slot.range[1]] });
    }
  });
  return { text, slots };
}

function normalize(input: AnalysisInput): Normalized {
  if (typeof input === "string") {
    return { text: input, inputRef: { kind: "string" }, slots: [] };
  }
  if (Array.isArray(input)) {
    const { text, slots } = joinWithSlots(
      input.map(messageText),
      input.map((m) => m.slots),
      false,
    );
    return { text, inputRef: { kind: "messages" }, messages: input, slots };
  }
  if ("text" in input && "slots" in input) {
    return { text: input.text, inputRef: { kind: "string" }, slots: input.slots };
  }
  const messages = input.messages ?? [];
  const toolsText =
    input.tools && input.tools.length > 0 ? JSON.stringify(input.tools, null, 2) : undefined;
  const { text, slots } = joinWithSlots(
    [input.system, ...messages.map(messageText), toolsText],
    [undefined, ...messages.map((m) => m.slots), undefined],
    true,
  );
  return { text, inputRef: { kind: "payload" }, messages, slots };
}

/**
 * Collapses overlapping savings claims into one selected finding per region. This replaces
 * the old exact-range-only deduplication. Treating every overlap as competing is conservative:
 * nested fixes can sometimes compose, so this may underestimate savings, but it never
 * overstates them by adding overlapping claims together.
 */
export function dedupedSavingsByRegion(
  findings: Finding[],
  totalTokens: number,
): { totalWasteTokens: number; cost?: { perCall: Money; per1000Calls: Money; atVolume?: Money } } {
  const candidates = findings
    .filter((finding) => finding.tokens.saved > 0)
    .sort(
      (a, b) =>
        a.loc.range[0] - b.loc.range[0] ||
        a.loc.range[1] - b.loc.range[1] ||
        a.ruleId.localeCompare(b.ruleId),
    );

  const selected: Finding[] = [];
  let group: Finding[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;

  const keepGroupMaximum = (): void => {
    if (group.length === 0) return;
    group.sort(
      (a, b) =>
        b.tokens.saved - a.tokens.saved ||
        a.loc.range[0] - b.loc.range[0] ||
        a.ruleId.localeCompare(b.ruleId),
    );
    selected.push(group[0]!);
    group = [];
    groupEnd = Number.NEGATIVE_INFINITY;
  };

  for (const finding of candidates) {
    const [start, end] = finding.loc.range;
    if (group.length > 0 && start >= groupEnd) keepGroupMaximum();
    group.push(finding);
    groupEnd = Math.max(groupEnd, end);
  }
  keepGroupMaximum();

  // A zero-savings finding cannot overlap any counted savings region, but it may still report
  // a real dollar estimate (for example cache-buster), so preserve its cost in the summary.
  const costContributors = [
    ...selected,
    ...findings.filter((finding) => finding.tokens.saved <= 0),
  ].filter(
    (finding): finding is Finding & { cost: NonNullable<Finding["cost"]> } =>
      finding.cost !== undefined,
  );
  let cost: Report["summary"]["cost"];
  if (costContributors.length > 0) {
    const perCall: Money = {
      amount: costContributors.reduce((sum, finding) => sum + finding.cost.perCall.amount, 0),
      currency: "USD",
    };
    const per1000Calls: Money = {
      amount: costContributors.reduce((sum, finding) => sum + finding.cost.per1000Calls.amount, 0),
      currency: "USD",
    };
    const atVolume =
      costContributors.every((finding) => finding.cost.atVolume !== undefined)
        ? {
            amount: costContributors.reduce(
              (sum, finding) => sum + finding.cost.atVolume!.amount,
              0,
            ),
            currency: "USD" as const,
          }
        : undefined;
    cost = { perCall, per1000Calls, ...(atVolume ? { atVolume } : {}) };
  }

  return {
    // Keep the token clamp separate from dollar estimates: selected findings' costs are
    // per-finding estimates, and there is no reliable attribution for scaling them by the cap.
    totalWasteTokens: Math.min(
      totalTokens,
      selected.reduce((sum, finding) => sum + finding.tokens.saved, 0),
    ),
    cost,
  };
}

export function analyze(input: AnalysisInput, options: AnalyzeOptions): Report {
  const normalized = normalize(input);
  const { text, messages, slots } = normalized;
  const inputRef = options.path
    ? { ...normalized.inputRef, path: options.path }
    : normalized.inputRef;
  const encoder = options.encoder ?? resolveEncoder(options.model);
  const tokenView = encoder.tokenize(text);
  const pricing = resolvePricing(options.model, options.pricingOverrides);

  const ctx: AnalysisContext = {
    text,
    inputRef,
    model: options.model,
    encoder,
    tokenView,
    jsonRegions: findJsonRegions(text),
    repeated: buildRepeatedSubstringIndex(tokenView.tokens),
    slots,
    messages,
    indentMap: text.split("\n").map((line) => line.length - line.trimStart().length),
    providerProfile: { cacheMinTokens: resolveCacheMinTokens(options.model, pricing?.provider) },
    autofix: options.autofix ?? true,
    budget: options.budget,
    baseline: options.baseline,
    pricingOverrides: options.pricingOverrides,
    volume: options.volume,
  };

  const findings: Finding[] = [];
  const byRule: Record<string, Finding[]> = {};
  for (const rule of options.rules ?? builtinRules) {
    const found = rule.check(ctx, rule.defaultSeverity);
    for (const finding of found) {
      // a rule may already have set an accurate custom cost (e.g. cache-buster's cache-rate
      // delta, which computeCost's tokensSaved * base-rate math can't express) -- don't
      // clobber it with the generic per-token computation.
      finding.cost ??= computeCost(
        finding.tokens.saved,
        options.model,
        options.volume,
        options.pricingOverrides,
      );
    }
    findings.push(...found);
    byRule[rule.id] = found;
  }

  const dynamicBudget = slots.reduce((sum, slot) => sum + encoder.countTokens(slot.value ?? ""), 0);
  const savings = dedupedSavingsByRegion(findings, tokenView.count);

  function applyFixes(options: ApplyFixesOptions = {}): string {
    const fixes = findings
      .filter((f) => f.fix && (!options.ruleIds || options.ruleIds.includes(f.ruleId)))
      .map((f) => f.fix!)
      .sort((a, b) => a.range[0] - b.range[0]);

    let result = "";
    let cursor = 0;
    for (const fix of fixes) {
      if (fix.range[0] < cursor) continue;
      result += text.slice(cursor, fix.range[0]) + fix.replacement;
      cursor = fix.range[1];
    }
    result += text.slice(cursor);
    return result;
  }

  return {
    summary: {
      totalTokens: tokenView.count,
      staticTokens: tokenView.count - dynamicBudget,
      dynamicBudget,
      totalWasteTokens: savings.totalWasteTokens,
      cost: savings.cost,
    },
    findings,
    byRule,
    applyFixes,
  };
}
