import { describe, expect, it } from "vitest";
import * as tokenSift from "../src/index.js";

describe("public entry point", () => {
  it("exposes the documented top-level API", () => {
    expect(typeof tokenSift.analyze).toBe("function");
    expect(typeof tokenSift.tokenize).toBe("function");
    expect(typeof tokenSift.createLinter).toBe("function");
    expect(typeof tokenSift.defineConfig).toBe("function");
    expect(typeof tokenSift.defineRule).toBe("function");
    expect(typeof tokenSift.budget).toBe("function");
    expect(typeof tokenSift.t).toBe("function");
    expect(typeof tokenSift.dyn).toBe("function");
  });

  it("budget() is a real implementation, not a stub", () => {
    const result = tokenSift.budget(
      { a: "short prompt", b: "a somewhat longer prompt with more words in it" },
      { model: "gpt-4o" },
    );
    expect(result.a!).toBeGreaterThan(0);
    expect(result.b!).toBeGreaterThan(result.a!);
  });

  it("does not export diff(), removed rather than left as a permanent stub", () => {
    expect("diff" in tokenSift).toBe(false);
  });

  it("builtinRules is frozen, so a consumer can't corrupt shared state by mutating it", () => {
    expect(Object.isFrozen(tokenSift.builtinRules)).toBe(true);
    expect(() => (tokenSift.builtinRules as unknown[]).push({})).toThrow();
  });

  it("exports per-family OpenAI encoders for bundle-size-conscious callers (edge functions)", () => {
    expect(typeof tokenSift.O200kBaseEncoder).toBe("function");
    expect(typeof tokenSift.Cl100kBaseEncoder).toBe("function");
    const encoder = new tokenSift.O200kBaseEncoder("gpt-4o");
    expect(encoder.family).toBe("o200k_base");
  });
});
