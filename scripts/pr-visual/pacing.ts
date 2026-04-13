import { PACING_MODES, type Pacing, type ScenarioStep } from "./types.js";

/** Pacing multipliers applied to the raw (content + action) hold time. */
export const PACING_MULTIPLIERS: Record<Pacing, number> = {
  quick: 0.6,
  normal: 1.0,
  slow: 1.5,
  dramatic: 2.0,
};

/** Minimum hold per pacing mode, guaranteeing every step has breathing room. */
export const PACING_FLOORS_MS: Record<Pacing, number> = {
  quick: 900,
  normal: 1700,
  slow: 2200,
  dramatic: 3200,
};

/** Maximum hold per pacing mode, preventing runaway durations for long captions. */
export const PACING_CAPS_MS: Record<Pacing, number> = {
  quick: 4000,
  normal: 8000,
  slow: 10000,
  dramatic: 12000,
};

/** Narrative beat. The `beat` field on steps arrives in #7, but the formula
 *  accepts a beat argument today so callers can opt in early. */
export type Beat = "setup" | "action" | "payoff" | "close";

/** Minimum hold time per narrative beat. Beat floors win over pacing caps —
 *  a `quick` + `payoff` step still earns scene-length breathing room. */
export const BEAT_MIN_HOLD_MS: Record<Beat, number> = {
  setup: 1200,
  action: 1800,
  payoff: 2800,
  close: 2200,
};

/** Default reading speed (words per second). */
export const DEFAULT_WORDS_PER_SECOND = 3.2;

/** Short captions are absorbed faster; bump the effective reading speed. */
export const SHORT_CAPTION_WORD_THRESHOLD = 6;
export const SHORT_CAPTION_WPS_BONUS = 0.6;

/** 800ms pre-action settle prepended when pacing is `dramatic` and the step
 *  has a visible caption. */
export const DRAMATIC_PRE_SETTLE_MS = 800;

/** Cushion added when the current action type differs from the previous one. */
export const TRANSITION_CUSHION_MS = 300;

export interface PacingContext {
  /** Action type of the previous step, if any. */
  previousAction?: ScenarioStep["action"];
  /** True until the first `navigate` step has executed. */
  isFirstNavigation: boolean;
}

export function createPacingContext(): PacingContext {
  return { isFirstNavigation: true };
}

/** Advance the context after a step has executed. */
export function advancePacingContext(
  ctx: PacingContext,
  step: ScenarioStep
): PacingContext {
  return {
    previousAction: step.action,
    isFirstNavigation:
      step.action === "navigate" ? false : ctx.isFirstNavigation,
  };
}

function actionBonusMs(step: ScenarioStep, ctx: PacingContext): number {
  switch (step.action) {
    case "navigate":
      return ctx.isFirstNavigation ? 2500 : 1200;
    case "click":
      return 600;
    case "scroll":
      return 600;
    case "type":
      return Math.ceil((step.value?.length ?? 0) / 10) * 200;
    case "highlight":
      // Matches demo-recorder's highlight bonus (800ms).
      return 800;
    case "wait":
    case "screenshot":
      return 0;
  }
}

export interface ComputeHoldOptions {
  /** Optional beat for floor enforcement. Will be surfaced on `ScenarioStep`
   *  in #7; for now callers may pass it explicitly. */
  beat?: Beat;
  /** Override reading speed. Defaults to {@link DEFAULT_WORDS_PER_SECOND}. */
  wordsPerSecond?: number;
}

function assertValidPacing(value: unknown): asserts value is Pacing {
  if (!PACING_MODES.includes(value as Pacing)) {
    throw new Error(
      `Invalid pacing="${String(value)}". Must be one of: ${PACING_MODES.join(", ")}.`
    );
  }
}

/**
 * Compute how long (ms) a step should hold on-screen after its action
 * completes, so the viewer can read the caption and absorb the change.
 *
 * The formula combines reading time, action-type bonus, and a transition
 * cushion; scales it by the pacing multiplier; and clamps to the pacing
 * floor/cap (with an optional beat floor applied on top).
 */
export function computeAdaptiveHoldMs(
  caption: string,
  step: ScenarioStep,
  context: PacingContext,
  options: ComputeHoldOptions = {}
): number {
  const pacing: Pacing = step.pacing ?? "normal";
  assertValidPacing(pacing);

  const wordsPerSecond = options.wordsPerSecond ?? DEFAULT_WORDS_PER_SECOND;
  const wordCount = caption.trim().split(/\s+/).filter(Boolean).length;
  const effectiveWps =
    wordCount <= SHORT_CAPTION_WORD_THRESHOLD
      ? wordsPerSecond + SHORT_CAPTION_WPS_BONUS
      : wordsPerSecond;
  const readingMs = (wordCount / effectiveWps) * 1000;

  const actionMs = actionBonusMs(step, context);

  const transitionMs =
    context.previousAction !== undefined &&
    context.previousAction !== step.action
      ? TRANSITION_CUSHION_MS
      : 0;

  const rawMs = readingMs + actionMs + transitionMs;
  const multiplier = PACING_MULTIPLIERS[pacing];
  const pacingFloor = PACING_FLOORS_MS[pacing];
  const pacingCap = PACING_CAPS_MS[pacing];
  const beatFloor = options.beat ? BEAT_MIN_HOLD_MS[options.beat] : 0;

  const scaled = Math.round(rawMs * multiplier);
  const floored = Math.max(pacingFloor, beatFloor, scaled);
  return Math.min(pacingCap, floored);
}

/** Returns the 800ms dramatic pre-settle when applicable, else 0. */
export function dramaticPreSettleMs(step: ScenarioStep): number {
  const pacing: Pacing = step.pacing ?? "normal";
  assertValidPacing(pacing);
  if (pacing !== "dramatic") return 0;
  if (!step.caption || step.caption.trim() === "") return 0;
  return DRAMATIC_PRE_SETTLE_MS;
}
