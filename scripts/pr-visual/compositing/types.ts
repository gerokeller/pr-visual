/**
 * Plain TypeScript shape for the Remotion composition props. Matches the
 * runtime contract registered in `register.tsx` and consumed by
 * `demo-video.tsx`.
 *
 * Kept dependency-free (no Zod) so this module can be imported from
 * pr-visual's main pipeline without dragging schema runtime into baseline
 * installs.
 */

export interface StepSummary {
  /** 1-based step index displayed in the outro. */
  index: number;
  /** Action verb (`navigate`, `click`, `type`, etc.) — drives icon + grouping. */
  action: string;
  /** Optional caption / annotation; falsy steps are filtered out of the outro. */
  annotation?: string;
}

export type Beat = "setup" | "action" | "payoff" | "close";
export type Emphasis = "normal" | "strong";

export interface CompositionInput {
  title: string;
  description: string;
  videoSrc: string;
  videoDurationFrames: number;
  fps: number;
  width: number;
  height: number;
  introDurationFrames: number;
  outroDurationFrames: number;
  brandColor: string;
  steps: StepSummary[];
  category?: string;
  sprintLabel?: string;
  orgName?: string;
  highlights?: string[];
  recordedDate?: string;
  recordingDurationSec?: number;
  /** Recorded video logical width (CSS pixels). Drives aspect-ratio fitting. */
  desktopVideoWidth?: number;
  /** Recorded video logical height (CSS pixels). */
  desktopVideoHeight?: number;
  /** When true, the composition renders captions as canvas overlays beneath
   *  the video instead of relying on burned-in ASS subtitles. */
  useCanvasCaptions?: boolean;
  /** Caption-bar height in canvas pixels (only used when `useCanvasCaptions`). */
  captionBarHeight?: number;
  /** End-of-step timestamps, ms from the start of the recording. */
  stepTimestamps?: number[];
  stepAnnotations?: (string | null)[];
  stepBeats?: (Beat | null)[];
  stepEmphases?: (Emphasis | null)[];
  stepActions?: string[];
  /** Mobile companion video, served from the bundle's public/ dir. */
  mobileVideoSrc?: string;
  /** Mobile recording dimensions in encoded pixels (viewport x DSF). */
  mobileWidth?: number;
  mobileHeight?: number;
  /** Composition layout for the mobile companion. */
  mobileLayout?: "side-by-side" | "pip" | "sequential";
  /** Voice-over clips. Each entry anchors a per-step audio file to the
   *  start of that scenario step on the canvas timeline. */
  voiceOverClips?: VoiceOverClip[];
}

export interface VoiceOverClip {
  /** Filename (relative to the Remotion bundle's `public/`) of the MP3. */
  src: string;
  /** Scenario step index this clip belongs to (0-based). */
  stepIndex: number;
  /** Duration of the clip in seconds (used to size the Remotion Sequence). */
  durationSec: number;
}

/** Runtime sanity check used by the renderer entry. Throws on missing
 *  required fields so partial inputs surface immediately rather than
 *  silently producing broken video. */
export function assertValidCompositionInput(
  input: unknown
): asserts input is CompositionInput {
  if (!input || typeof input !== "object") {
    throw new Error("CompositionInput must be an object.");
  }
  const i = input as Record<string, unknown>;
  const required = [
    "title",
    "description",
    "videoSrc",
    "videoDurationFrames",
    "fps",
    "width",
    "height",
    "introDurationFrames",
    "outroDurationFrames",
    "brandColor",
    "steps",
  ] as const;
  for (const key of required) {
    if (i[key] === undefined || i[key] === null) {
      throw new Error(`CompositionInput.${key} is required.`);
    }
  }
  if (!Array.isArray(i.steps)) {
    throw new Error("CompositionInput.steps must be an array.");
  }
  for (const numericKey of [
    "videoDurationFrames",
    "fps",
    "width",
    "height",
    "introDurationFrames",
    "outroDurationFrames",
  ] as const) {
    const v = i[numericKey];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(
        `CompositionInput.${numericKey} must be a non-negative finite number.`
      );
    }
  }
}
