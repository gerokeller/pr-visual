import { BEATS, EMPHASIS_MODES, PACING_MODES, type Scenario } from "./types.js";

/**
 * Validate narrative / pacing enum fields on scenarios. Hard-fails on any
 * invalid value so problems surface at scenario-generation time rather than
 * deep inside the capture loop.
 */
export function validateScenarios(scenarios: Scenario[]): void {
  for (let s = 0; s < scenarios.length; s++) {
    const scenario = scenarios[s]!;
    const where = `scenarios[${s}] "${scenario.name}"`;

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]!;
      const stepWhere = `${where} step[${i}]`;

      if (step.pacing !== undefined && !PACING_MODES.includes(step.pacing)) {
        throw new Error(
          `Invalid pacing="${step.pacing}" at ${stepWhere}. Must be one of: ${PACING_MODES.join(", ")}.`
        );
      }
      if (step.beat !== undefined && !BEATS.includes(step.beat)) {
        throw new Error(
          `Invalid beat="${step.beat}" at ${stepWhere}. Must be one of: ${BEATS.join(", ")}.`
        );
      }
      if (
        step.emphasis !== undefined &&
        !EMPHASIS_MODES.includes(step.emphasis)
      ) {
        throw new Error(
          `Invalid emphasis="${step.emphasis}" at ${stepWhere}. Must be one of: ${EMPHASIS_MODES.join(", ")}.`
        );
      }
    }
  }
}
