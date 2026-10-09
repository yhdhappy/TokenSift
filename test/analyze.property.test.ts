import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dedupedSavingsByRegion } from "../src/analyze.js";
import type { Finding } from "../src/types.js";

// The oracle finds connected components by pairwise range intersection, a different
// approach from the production sweep, then takes the largest claim in each component.
function expectedTotal(spans: { range: [number, number]; saved: number }[]): number {
  const remaining = new Set(spans.map((_, index) => index).filter((i) => spans[i]!.saved > 0));
  let total = 0;
  while (remaining.size > 0) {
    const pending = [remaining.values().next().value as number];
    remaining.delete(pending[0]!);
    let groupMax = 0;
    while (pending.length > 0) {
      const currentIndex = pending.pop()!;
      const current = spans[currentIndex]!;
      groupMax = Math.max(groupMax, current.saved);
      for (const candidateIndex of [...remaining]) {
        const candidate = spans[candidateIndex]!;
        const strictlyOverlaps =
          current.range[0] < candidate.range[1] && candidate.range[0] < current.range[1];
        if (strictlyOverlaps) {
          remaining.delete(candidateIndex);
          pending.push(candidateIndex);
        }
      }
    }
    total += groupMax;
  }
  return total;
}

function findingsFromSpans(spans: { range: [number, number]; saved: number }[]): Finding[] {
  return spans.map((span, index) => ({
    ruleId: `synthetic-${index}`,
    severity: "info",
    message: `span ${index}`,
    why: "test fixture finding",
    loc: { input: { kind: "string" }, range: span.range },
    tokens: { current: span.saved + 1, afterFix: 1, saved: span.saved },
    confidence: "exact",
  }));
}

const span = fc
  .tuple(fc.nat({ max: 500 }), fc.integer({ min: 1, max: 50 }))
  .map(([start, len]): [number, number] => [start, start + len]);

const spanWithSaved = fc.record({ range: span, saved: fc.nat({ max: 1000 }) });

describe("totalWasteTokens dedup (property-based)", () => {
  it("matches a connected-component oracle for arbitrary overlapping ranges", () => {
    fc.assert(
      fc.property(fc.array(spanWithSaved, { maxLength: 20 }), (spans) => {
        const result = dedupedSavingsByRegion(
          findingsFromSpans(spans),
          Number.MAX_SAFE_INTEGER,
        );
        expect(result.totalWasteTokens).toBe(expectedTotal(spans));
      }),
    );
  });

  it("never exceeds the naive sum of every finding's saved tokens", () => {
    fc.assert(
      fc.property(fc.array(spanWithSaved, { maxLength: 20 }), (spans) => {
        const result = dedupedSavingsByRegion(findingsFromSpans(spans), Number.MAX_SAFE_INTEGER);
        const naiveSum = spans.reduce((sum, s) => sum + s.saved, 0);
        expect(result.totalWasteTokens).toBeLessThanOrEqual(naiveSum);
      }),
    );
  });

  it("is never negative", () => {
    fc.assert(
      fc.property(fc.array(spanWithSaved, { maxLength: 20 }), (spans) => {
        const result = dedupedSavingsByRegion(findingsFromSpans(spans), Number.MAX_SAFE_INTEGER);
        expect(result.totalWasteTokens).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("counts nested overlapping findings once, using the larger savings claim", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 200, max: 400 }),
        fc.integer({ min: 101, max: 199 }),
        fc.integer({ min: 1, max: 50 }),
        fc.nat({ max: 1000 }),
        fc.nat({ max: 1000 }),
        (outerStart, outerEnd, innerStart, innerLen, outerSaved, innerSaved) => {
          const innerEnd = innerStart + innerLen;
          fc.pre(innerEnd < outerEnd);
          const spans = [
            { range: [outerStart, outerEnd] as [number, number], saved: outerSaved },
            { range: [innerStart, innerEnd] as [number, number], saved: innerSaved },
          ];
          const result = dedupedSavingsByRegion(
            findingsFromSpans(spans),
            Number.MAX_SAFE_INTEGER,
          );
          expect(result.totalWasteTokens).toBe(Math.max(outerSaved, innerSaved));
        },
      ),
    );
  });
});
