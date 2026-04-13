import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_DSF,
  DEFAULT_MOBILE_LAYOUT,
  DEFAULT_MOBILE_VIEWPORT,
  applyMobileOverrides,
  resolveMobileConfig,
} from "../../scripts/pr-visual/mobile-pass.js";
import type { ScenarioStep } from "../../scripts/pr-visual/types.js";

describe("resolveMobileConfig", () => {
  it("falls back to documented defaults when nothing is set", () => {
    const c = resolveMobileConfig(undefined);
    expect(c).toEqual({
      width: DEFAULT_MOBILE_VIEWPORT.width,
      height: DEFAULT_MOBILE_VIEWPORT.height,
      deviceScaleFactor: DEFAULT_MOBILE_DSF,
      layout: DEFAULT_MOBILE_LAYOUT,
    });
    expect(DEFAULT_MOBILE_VIEWPORT).toEqual({ width: 390, height: 844 });
    expect(DEFAULT_MOBILE_DSF).toBe(3);
    expect(DEFAULT_MOBILE_LAYOUT).toBe("side-by-side");
  });

  it("respects explicit viewport / dsf / layout overrides", () => {
    const c = resolveMobileConfig({
      enabled: true,
      viewport: { width: 414, height: 896 },
      deviceScaleFactor: 2,
      layout: "pip",
    });
    expect(c).toEqual({
      width: 414,
      height: 896,
      deviceScaleFactor: 2,
      layout: "pip",
    });
  });
});

describe("applyMobileOverrides", () => {
  function navigate(overrides: Partial<ScenarioStep> = {}): ScenarioStep {
    return {
      action: "navigate",
      url: "/",
      caption: "Open desktop home",
      ...overrides,
    };
  }
  function click(overrides: Partial<ScenarioStep> = {}): ScenarioStep {
    return {
      action: "click",
      selector: "#desktop-cta",
      caption: "Tap CTA",
      ...overrides,
    };
  }

  it("returns the step unchanged when no mobile fields are set", () => {
    const step = click();
    expect(applyMobileOverrides(step)).toBe(step);
  });

  it("returns null when mobileSkip is true", () => {
    expect(applyMobileOverrides(click({ mobileSkip: true }))).toBeNull();
  });

  it("swaps selector when mobileSelector is set", () => {
    const out = applyMobileOverrides(click({ mobileSelector: "#mobile-cta" }));
    expect(out).not.toBeNull();
    expect(out!.selector).toBe("#mobile-cta");
    // Original selector preserved on the source step.
    expect(out).not.toHaveProperty("__mutated_in_place");
  });

  it("swaps url path when mobilePath is set on a navigate step", () => {
    const out = applyMobileOverrides(navigate({ mobilePath: "/m" }));
    expect(out).not.toBeNull();
    expect(out!.url).toBe("/m");
  });

  it("preserves unrelated fields (action, caption, value)", () => {
    const out = applyMobileOverrides(
      click({
        value: "irrelevant",
        caption: "stays the same",
        mobileSelector: "#m",
      })
    );
    expect(out!.action).toBe("click");
    expect(out!.value).toBe("irrelevant");
    expect(out!.caption).toBe("stays the same");
  });

  it("does not mutate the input step", () => {
    const step = click({ mobileSelector: "#m" });
    const out = applyMobileOverrides(step);
    expect(step.selector).toBe("#desktop-cta");
    expect(out!.selector).toBe("#m");
  });
});
