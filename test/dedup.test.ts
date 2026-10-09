import { describe, expect, it } from "vitest";
import { dedupedSavingsByRegion } from "../src/analyze.js";
import type { Finding, Money } from "../src/types.js";

const usd = (amount: number): Money => ({ amount, currency: "USD" });

function finding(
  ruleId: string,
  range: [number, number],
  saved: number,
  cost?: { perCall: number; per1000Calls: number; atVolume?: number },
): Finding {
  return {
    ruleId,
    severity: "info",
    message: ruleId,
    why: "synthetic finding",
    loc: { input: { kind: "string" }, range },
    tokens: { current: saved + 1, afterFix: 1, saved },
    confidence: "exact",
    ...(cost
      ? {
          cost: {
            perCall: usd(cost.perCall),
            per1000Calls: usd(cost.per1000Calls),
            ...(cost.atVolume === undefined ? {} : { atVolume: usd(cost.atVolume) }),
          },
        }
      : {}),
  };
}

describe("dedupedSavingsByRegion", () => {
  it("keeps the maximum savings for an exact range and counts it once", () => {
    const result = dedupedSavingsByRegion(
      [finding("small", [2, 8], 5), finding("large", [2, 8], 9)],
      50,
    );
    expect(result.totalWasteTokens).toBe(9);
  });

  it("keeps only the maximum claim for partially overlapping ranges", () => {
    const result = dedupedSavingsByRegion(
      [finding("left", [0, 6], 7), finding("right", [5, 10], 11)],
      50,
    );
    expect(result.totalWasteTokens).toBe(11);
  });

  it("keeps adjacent touching ranges in separate groups", () => {
    const result = dedupedSavingsByRegion(
      [finding("left", [0, 5], 7), finding("right", [5, 10], 11)],
      50,
    );
    expect(result.totalWasteTokens).toBe(18);
  });

  it("sums disjoint ranges", () => {
    const result = dedupedSavingsByRegion(
      [finding("first", [0, 4], 7), finding("second", [10, 14], 11)],
      50,
    );
    expect(result.totalWasteTokens).toBe(18);
  });

  it("uses the selected maximum finding's cost and sums costs across groups", () => {
    const result = dedupedSavingsByRegion(
      [
        finding("loser", [0, 8], 5, { perCall: 0.01, per1000Calls: 10, atVolume: 100 }),
        finding("winner", [2, 10], 9, { perCall: 0.03, per1000Calls: 30, atVolume: 300 }),
        finding("other", [20, 25], 4, { perCall: 0.02, per1000Calls: 20, atVolume: 200 }),
      ],
      50,
    );
    expect(result.cost).toEqual({
      perCall: usd(0.05),
      per1000Calls: usd(50),
      atVolume: usd(500),
    });
  });

  it("includes the cost of a zero-savings finding", () => {
    const result = dedupedSavingsByRegion(
      [finding("cache-buster", [0, 0], 0, { perCall: 0.02, per1000Calls: 20, atVolume: 200 })],
      50,
    );
    expect(result.cost).toEqual({
      perCall: usd(0.02),
      per1000Calls: usd(20),
      atVolume: usd(200),
    });
  });

  it("omits atVolume when a zero-savings cost contributor has no volume estimate", () => {
    const result = dedupedSavingsByRegion(
      [
        finding("selected", [0, 2], 2, { perCall: 0.01, per1000Calls: 10, atVolume: 100 }),
        finding("cache-buster", [4, 4], 0, { perCall: 0.02, per1000Calls: 20 }),
      ],
      50,
    );
    expect(result.cost).toEqual({ perCall: usd(0.03), per1000Calls: usd(30) });
  });

  it("omits cost when none of the findings has cost", () => {
    const result = dedupedSavingsByRegion([finding("uncosted", [0, 2], 1)], 10);
    expect(result.cost).toBeUndefined();
  });

  it("includes atVolume only when every selected finding has it", () => {
    const result = dedupedSavingsByRegion(
      [
        finding("priced", [0, 2], 1, { perCall: 0.01, per1000Calls: 10, atVolume: 100 }),
        finding("without-volume", [4, 6], 2, { perCall: 0.02, per1000Calls: 20 }),
      ],
      10,
    );
    expect(result.cost).toEqual({ perCall: usd(0.03), per1000Calls: usd(30) });
  });

  it("caps overlapping claims at totalTokens", () => {
    const result = dedupedSavingsByRegion(
      [finding("first", [0, 8], 20), finding("second", [7, 12], 30)],
      15,
    );
    expect(result.totalWasteTokens).toBe(15);
  });

  it("does not mutate the findings array", () => {
    const input = [finding("later", [10, 12], 2), finding("earlier", [0, 2], 1)];
    const before = input.slice();
    dedupedSavingsByRegion(input, 10);
    expect(input).toEqual(before);
    expect(input[0]).toBe(before[0]);
    expect(input[1]).toBe(before[1]);
  });
});
