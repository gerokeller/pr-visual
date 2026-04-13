import { describe, it, expect } from "vitest";
import {
  DEFAULT_HIGHLIGHT_DURATION_MS,
  resolveInputVariant,
} from "../../scripts/pr-visual/overlays.js";

describe("resolveInputVariant()", () => {
  it("returns 'mobile' when viewport is mobile", () => {
    expect(resolveInputVariant({ isMobile: true })).toBe("mobile");
  });

  it("returns 'desktop' when viewport is not mobile", () => {
    expect(resolveInputVariant({ isMobile: false })).toBe("desktop");
  });

  it("defaults to 'desktop' when isMobile is undefined", () => {
    expect(resolveInputVariant({})).toBe("desktop");
  });
});

describe("DEFAULT_HIGHLIGHT_DURATION_MS", () => {
  it("is 1500ms", () => {
    expect(DEFAULT_HIGHLIGHT_DURATION_MS).toBe(1500);
  });
});
