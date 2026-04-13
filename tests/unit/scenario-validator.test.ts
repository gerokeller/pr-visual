import { describe, it, expect } from "vitest";
import { validateScenarios } from "../../scripts/pr-visual/scenario-validator.js";
import type { Scenario } from "../../scripts/pr-visual/types.js";

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: "demo",
    description: "test",
    steps: [{ action: "navigate", url: "/", caption: "Open the app" }],
    ...overrides,
  };
}

describe("validateScenarios()", () => {
  it("accepts a scenario with no narrative fields", () => {
    expect(() => validateScenarios([scenario()])).not.toThrow();
  });

  it("accepts all valid beat values", () => {
    for (const beat of ["setup", "action", "payoff", "close"] as const) {
      expect(() =>
        validateScenarios([
          scenario({
            steps: [{ action: "click", selector: "#x", caption: "c", beat }],
          }),
        ])
      ).not.toThrow();
    }
  });

  it("accepts all valid emphasis values", () => {
    for (const emphasis of ["normal", "strong"] as const) {
      expect(() =>
        validateScenarios([
          scenario({
            steps: [
              { action: "click", selector: "#x", caption: "c", emphasis },
            ],
          }),
        ])
      ).not.toThrow();
    }
  });

  it("accepts all valid pacing values", () => {
    for (const pacing of ["quick", "normal", "slow", "dramatic"] as const) {
      expect(() =>
        validateScenarios([
          scenario({
            steps: [{ action: "click", selector: "#x", caption: "c", pacing }],
          }),
        ])
      ).not.toThrow();
    }
  });

  it("rejects invalid beat with a clear error including scenario and step index", () => {
    expect(() =>
      validateScenarios([
        scenario({
          steps: [
            {
              action: "click",
              selector: "#x",
              caption: "c",
              beat: "finale" as never,
            },
          ],
        }),
      ])
    ).toThrowError(
      /Invalid beat="finale" at scenarios\[0\] "demo" step\[0\]\. Must be one of: setup, action, payoff, close\./
    );
  });

  it("rejects invalid emphasis", () => {
    expect(() =>
      validateScenarios([
        scenario({
          steps: [
            {
              action: "click",
              selector: "#x",
              caption: "c",
              emphasis: "loud" as never,
            },
          ],
        }),
      ])
    ).toThrowError(/Invalid emphasis="loud"/);
  });

  it("rejects invalid pacing", () => {
    expect(() =>
      validateScenarios([
        scenario({
          steps: [
            {
              action: "click",
              selector: "#x",
              caption: "c",
              pacing: "ultra" as never,
            },
          ],
        }),
      ])
    ).toThrowError(/Invalid pacing="ultra"/);
  });

  it("reports the correct step index when a later step is bad", () => {
    expect(() =>
      validateScenarios([
        scenario({
          steps: [
            { action: "navigate", url: "/", caption: "a" },
            { action: "click", selector: "#x", caption: "b" },
            {
              action: "click",
              selector: "#y",
              caption: "c",
              beat: "boom" as never,
            },
          ],
        }),
      ])
    ).toThrowError(/step\[2\]/);
  });

  it("does not throw when persona is any free-form string", () => {
    expect(() =>
      validateScenarios([scenario({ persona: "Customer Success Manager" })])
    ).not.toThrow();
  });

  it("accepts a valid highlight step with selector", () => {
    expect(() =>
      validateScenarios([
        scenario({
          steps: [
            {
              action: "highlight",
              selector: "#primary-cta",
              caption: "Pulse the CTA",
            },
          ],
        }),
      ])
    ).not.toThrow();
  });

  it("rejects a highlight step without a selector", () => {
    expect(() =>
      validateScenarios([
        scenario({
          steps: [{ action: "highlight", caption: "no selector" }],
        }),
      ])
    ).toThrowError(/Missing selector for highlight step/);
  });
});
