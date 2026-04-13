import { describe, expect, it } from "vitest";
import {
  COMPOSITION_READING_WPS,
  INTRO_MAX_SECONDS,
  INTRO_MIN_SECONDS,
  OUTRO_MAX_SECONDS,
  OUTRO_MIN_SECONDS,
  computeAdaptiveDurations,
} from "../../scripts/pr-visual/compositing/duration.js";

const FPS = 30;

describe("computeAdaptiveDurations", () => {
  it("clamps very short content to the intro/outro minimums", () => {
    const { introFrames, outroFrames } = computeAdaptiveDurations(
      "Hi",
      "",
      0,
      FPS
    );
    expect(introFrames).toBe(Math.round(INTRO_MIN_SECONDS * FPS));
    expect(outroFrames).toBe(Math.round(OUTRO_MIN_SECONDS * FPS));
  });

  it("clamps very long content to the intro/outro maximums", () => {
    const longTitle = "word ".repeat(200).trim();
    const longDesc = "word ".repeat(500).trim();
    const { introFrames, outroFrames } = computeAdaptiveDurations(
      longTitle,
      longDesc,
      200,
      FPS
    );
    expect(introFrames).toBe(Math.round(INTRO_MAX_SECONDS * FPS));
    expect(outroFrames).toBe(Math.round(OUTRO_MAX_SECONDS * FPS));
  });

  it("scales intro length with title + description word count", () => {
    const { introFrames: short } = computeAdaptiveDurations("a b", "", 0, FPS);
    const { introFrames: long } = computeAdaptiveDurations(
      "a b c d e f g h i j",
      "",
      0,
      FPS
    );
    expect(long).toBeGreaterThan(short);
  });

  it("scales outro length with annotated step count", () => {
    const { outroFrames: few } = computeAdaptiveDurations("t", "d", 1, FPS);
    const { outroFrames: many } = computeAdaptiveDurations("t", "d", 12, FPS);
    expect(many).toBeGreaterThan(few);
  });

  it("uses the configured fps to convert seconds to frames", () => {
    const at30 = computeAdaptiveDurations("hello world", "", 0, 30);
    const at60 = computeAdaptiveDurations("hello world", "", 0, 60);
    // 60 fps should yield ~2x the frame count for the same hold seconds.
    expect(at60.introFrames).toBeGreaterThan(at30.introFrames);
  });

  it("exposes the documented reading speed default", () => {
    expect(COMPOSITION_READING_WPS).toBe(3);
  });
});
