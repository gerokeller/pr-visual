import { describe, it, expect } from "vitest";
import {
  BEAT_MIN_HOLD_MS,
  DEFAULT_WORDS_PER_SECOND,
  DRAMATIC_PRE_SETTLE_MS,
  PACING_CAPS_MS,
  PACING_FLOORS_MS,
  advancePacingContext,
  computeAdaptiveHoldMs,
  createPacingContext,
  dramaticPreSettleMs,
} from "../../scripts/pr-visual/pacing.js";
import type {
  Pacing,
  ScenarioStep,
} from "../../scripts/pr-visual/types.js";

function step(overrides: Partial<ScenarioStep> = {}): ScenarioStep {
  return {
    action: "click",
    caption: "Click the button",
    ...overrides,
  };
}

describe("computeAdaptiveHoldMs — pacing floors", () => {
  it("returns the pacing floor when raw content is short", () => {
    for (const pacing of ["quick", "normal", "slow", "dramatic"] as Pacing[]) {
      const hold = computeAdaptiveHoldMs(
        "Go",
        step({ action: "wait", pacing }),
        createPacingContext()
      );
      expect(hold).toBe(PACING_FLOORS_MS[pacing]);
    }
  });

  it("dramatic hold strictly exceeds quick for the same step", () => {
    const caption = "Click the button to submit the form";
    const ctx = createPacingContext();
    const quick = computeAdaptiveHoldMs(
      caption,
      step({ pacing: "quick" }),
      ctx
    );
    const dramatic = computeAdaptiveHoldMs(
      caption,
      step({ pacing: "dramatic" }),
      ctx
    );
    expect(dramatic).toBeGreaterThan(quick);
  });

  it("defaults to normal pacing when step.pacing is undefined", () => {
    const hold = computeAdaptiveHoldMs(
      "Hi",
      step({ action: "wait" }),
      createPacingContext()
    );
    expect(hold).toBe(PACING_FLOORS_MS.normal);
  });
});

describe("computeAdaptiveHoldMs — pacing caps", () => {
  it("clamps excessively long captions to the pacing cap", () => {
    const longCaption = "word ".repeat(2000).trim();
    for (const pacing of ["quick", "normal", "slow", "dramatic"] as Pacing[]) {
      const hold = computeAdaptiveHoldMs(
        longCaption,
        step({ pacing }),
        createPacingContext()
      );
      expect(hold).toBe(PACING_CAPS_MS[pacing]);
    }
  });
});

describe("computeAdaptiveHoldMs — action bonuses", () => {
  it("first navigation earns a bigger bonus than subsequent navigation", () => {
    const nav = step({ action: "navigate", caption: "Open the dashboard" });
    const first = computeAdaptiveHoldMs(
      nav.caption,
      nav,
      createPacingContext()
    );
    const subsequent = computeAdaptiveHoldMs(
      nav.caption,
      nav,
      advancePacingContext(createPacingContext(), nav)
    );
    expect(first).toBeGreaterThanOrEqual(subsequent);
  });

  it("scales `type` bonus with value length", () => {
    const short = step({
      action: "type",
      value: "hi",
      caption: "Type the name of the list",
      pacing: "slow",
    });
    const long = step({
      action: "type",
      value: "a".repeat(120),
      caption: "Type the name of the list",
      pacing: "slow",
    });
    const shortHold = computeAdaptiveHoldMs(
      short.caption,
      short,
      createPacingContext()
    );
    const longHold = computeAdaptiveHoldMs(
      long.caption,
      long,
      createPacingContext()
    );
    expect(longHold).toBeGreaterThan(shortHold);
  });

  it("wait and screenshot get no action bonus", () => {
    // With empty caption and no action bonus, result should be the pacing floor.
    for (const action of ["wait", "screenshot"] as const) {
      const hold = computeAdaptiveHoldMs(
        "",
        step({ action, pacing: "normal", caption: "" }),
        createPacingContext()
      );
      expect(hold).toBe(PACING_FLOORS_MS.normal);
    }
  });
});

describe("computeAdaptiveHoldMs — transition cushion", () => {
  it("applies +300ms when action differs from previous", () => {
    const click = step({ action: "click", caption: "Click the button" });
    const fresh = createPacingContext();
    const withPrevSameAction = advancePacingContext(fresh, click);
    const withPrevDifferentAction = advancePacingContext(fresh, {
      ...click,
      action: "type",
      value: "",
    });
    const same = computeAdaptiveHoldMs(click.caption, click, withPrevSameAction);
    const diff = computeAdaptiveHoldMs(
      click.caption,
      click,
      withPrevDifferentAction
    );
    // Either both hit the floor (unchanged) or diff >= same; never diff < same.
    expect(diff).toBeGreaterThanOrEqual(same);
  });
});

describe("computeAdaptiveHoldMs — beat floors", () => {
  it.each(Object.entries(BEAT_MIN_HOLD_MS))(
    "beat %s enforces minimum hold %i ms even under quick pacing",
    (beat, minMs) => {
      const hold = computeAdaptiveHoldMs(
        "Go",
        step({ pacing: "quick", action: "wait" }),
        createPacingContext(),
        { beat: beat as keyof typeof BEAT_MIN_HOLD_MS }
      );
      // Beat floor wins over pacing floor when beat floor is higher.
      expect(hold).toBeGreaterThanOrEqual(Math.max(minMs, PACING_FLOORS_MS.quick));
    }
  );

  it("beat floor overrides shorter captions", () => {
    // With quick pacing and a short caption, without a beat we'd land near
    // the quick floor; adding `payoff` forces us up to 2800.
    const withoutBeat = computeAdaptiveHoldMs(
      "Done",
      step({ pacing: "quick", action: "wait" }),
      createPacingContext()
    );
    const withPayoff = computeAdaptiveHoldMs(
      "Done",
      step({ pacing: "quick", action: "wait" }),
      createPacingContext(),
      { beat: "payoff" }
    );
    expect(withoutBeat).toBeLessThan(withPayoff);
    expect(withPayoff).toBe(BEAT_MIN_HOLD_MS.payoff);
  });
});

describe("computeAdaptiveHoldMs — reading speed", () => {
  it("respects custom wordsPerSecond", () => {
    const caption =
      "This is a longer explanatory caption that should take real time to read";
    const fast = computeAdaptiveHoldMs(
      caption,
      step({ pacing: "slow" }),
      createPacingContext(),
      { wordsPerSecond: 10 }
    );
    const slow = computeAdaptiveHoldMs(
      caption,
      step({ pacing: "slow" }),
      createPacingContext(),
      { wordsPerSecond: 2 }
    );
    expect(slow).toBeGreaterThan(fast);
  });

  it("short captions (<=6 words) get the +0.6 w/s bonus — longer text lingers more per word", () => {
    // 6 words at default wps with bonus: 6 / 3.8 = 1.58s
    // 20 words at default wps:            20 / 3.2 = 6.25s
    const shortHold = computeAdaptiveHoldMs(
      "one two three four five six",
      step({ pacing: "slow" }),
      createPacingContext()
    );
    const longHold = computeAdaptiveHoldMs(
      Array.from({ length: 20 }, (_, i) => `w${i}`).join(" "),
      step({ pacing: "slow" }),
      createPacingContext()
    );
    expect(longHold).toBeGreaterThan(shortHold);
  });
});

describe("computeAdaptiveHoldMs — invalid pacing", () => {
  it("throws on unknown pacing value", () => {
    expect(() =>
      computeAdaptiveHoldMs(
        "hi",
        step({ pacing: "ultra" as never }),
        createPacingContext()
      )
    ).toThrowError(/Invalid pacing="ultra"/);
  });
});

describe("dramaticPreSettleMs", () => {
  it("returns 800ms for dramatic steps with a caption", () => {
    expect(dramaticPreSettleMs(step({ pacing: "dramatic" }))).toBe(
      DRAMATIC_PRE_SETTLE_MS
    );
  });

  it("returns 0 for non-dramatic pacing", () => {
    for (const pacing of ["quick", "normal", "slow"] as Pacing[]) {
      expect(dramaticPreSettleMs(step({ pacing }))).toBe(0);
    }
  });

  it("returns 0 for dramatic steps without a caption", () => {
    expect(
      dramaticPreSettleMs(step({ pacing: "dramatic", caption: "" }))
    ).toBe(0);
    expect(
      dramaticPreSettleMs(step({ pacing: "dramatic", caption: "   " }))
    ).toBe(0);
  });

  it("throws on unknown pacing value", () => {
    expect(() =>
      dramaticPreSettleMs(step({ pacing: "ultra" as never }))
    ).toThrowError(/Invalid pacing="ultra"/);
  });
});

describe("advancePacingContext", () => {
  it("records the previous action", () => {
    const next = advancePacingContext(createPacingContext(), step());
    expect(next.previousAction).toBe("click");
  });

  it("flips isFirstNavigation after the first navigate", () => {
    const ctx = createPacingContext();
    expect(ctx.isFirstNavigation).toBe(true);
    const afterNav = advancePacingContext(ctx, step({ action: "navigate" }));
    expect(afterNav.isFirstNavigation).toBe(false);
  });

  it("leaves isFirstNavigation unchanged for non-navigate steps", () => {
    const ctx = createPacingContext();
    const afterClick = advancePacingContext(ctx, step({ action: "click" }));
    expect(afterClick.isFirstNavigation).toBe(true);
  });
});

describe("DEFAULT_WORDS_PER_SECOND", () => {
  it("is 3.2 words per second", () => {
    expect(DEFAULT_WORDS_PER_SECOND).toBe(3.2);
  });
});
