import { FPS } from "./styles.js";

/** Reading speed used to scale intro/outro duration with content length. */
export const COMPOSITION_READING_WPS = 3;

/** Floor / ceiling on intro and outro duration so very short or very long
 *  recordings still produce a usable composition. */
export const INTRO_MIN_SECONDS = 3;
export const INTRO_MAX_SECONDS = 8;
export const OUTRO_MIN_SECONDS = 4;
export const OUTRO_MAX_SECONDS = 12;

export interface AdaptiveDurations {
  introFrames: number;
  outroFrames: number;
}

/** Compute intro/outro frame counts from the title/description text and
 *  the number of annotated steps that will appear in the outro summary.
 *
 *  Intro length scales with the title + description word count.
 *  Outro length scales with both the description and the number of steps. */
export function computeAdaptiveDurations(
  title: string,
  description: string,
  annotatedStepCount: number,
  fps: number = FPS
): AdaptiveDurations {
  const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

  const titleWords = wordCount(title);
  const descWords = wordCount(description);
  const introWords = titleWords + descWords;

  // Intro: reading time + a 1.5s entrance.
  const introSeconds = clamp(
    1.5 + introWords / COMPOSITION_READING_WPS,
    INTRO_MIN_SECONDS,
    INTRO_MAX_SECONDS
  );

  // Outro: reading time for the description + 0.4s per step row + 1.5s tail.
  const outroSeconds = clamp(
    1.5 + descWords / COMPOSITION_READING_WPS + annotatedStepCount * 0.4,
    OUTRO_MIN_SECONDS,
    OUTRO_MAX_SECONDS
  );

  return {
    introFrames: Math.round(introSeconds * fps),
    outroFrames: Math.round(outroSeconds * fps),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
