import type { LoadedPoms } from "./pom.js";
import {
  BEATS,
  EMPHASIS_MODES,
  PACING_MODES,
  type AuthConfig,
  type Scenario,
} from "./types.js";

export interface ValidationOptions {
  /** When provided, scenarios that reference a profile must match a key in
   *  `auth.profiles`. Profiles unknown to the project config hard-fail. */
  auth?: AuthConfig;
  /** Loaded POM modules keyed by `page` name. When supplied, `pom` steps
   *  are validated against the registered methods. Without this, a `pom`
   *  step fails validation because there are no known modules. */
  poms?: LoadedPoms;
}

/**
 * Validate narrative / pacing enum fields on scenarios and any
 * cross-config references (e.g. `Scenario.profile`). Hard-fails on any
 * invalid value so problems surface at scenario-generation time rather than
 * deep inside the capture loop.
 */
export function validateScenarios(
  scenarios: Scenario[],
  options: ValidationOptions = {}
): void {
  const knownProfiles = new Set(Object.keys(options.auth?.profiles ?? {}));

  for (let s = 0; s < scenarios.length; s++) {
    const scenario = scenarios[s]!;
    const where = `scenarios[${s}] "${scenario.name}"`;

    if (scenario.profile !== undefined) {
      if (knownProfiles.size === 0) {
        throw new Error(
          `${where} requests auth profile "${scenario.profile}" but no profiles are configured. Add an \`auth.profiles\` block to your .pr-visual.config.ts.`
        );
      }
      if (!knownProfiles.has(scenario.profile)) {
        const known = Array.from(knownProfiles).join(", ");
        throw new Error(
          `${where} requests unknown auth profile "${scenario.profile}". Known profiles: ${known}.`
        );
      }
    }

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]!;
      const stepWhere = `${where} step[${i}]`;

      if (step.action === "highlight" && !step.selector) {
        throw new Error(
          `Missing selector for highlight step at ${stepWhere}. The highlight action requires a CSS selector.`
        );
      }
      if (step.action === "pom") {
        if (!step.page) {
          throw new Error(
            `Missing \`page\` on pom step at ${stepWhere}. Specify the POM name registered in \`ProjectConfig.poms\`.`
          );
        }
        if (!step.method) {
          throw new Error(
            `Missing \`method\` on pom step at ${stepWhere}. Specify the function name exported by the POM module.`
          );
        }
        const poms = options.poms;
        if (!poms) {
          throw new Error(
            `${where} uses a pom step but no POM modules are configured. Add a \`poms\` block to your .pr-visual.config.ts.`
          );
        }
        const mod = poms[step.page];
        if (!mod) {
          const known = Object.keys(poms).join(", ") || "<none configured>";
          throw new Error(
            `Unknown POM page "${step.page}" at ${stepWhere}. Known pages: ${known}.`
          );
        }
        if (typeof mod[step.method] !== "function") {
          const methods = Object.keys(mod).join(", ") || "<none exported>";
          throw new Error(
            `Unknown POM method "${step.page}.${step.method}" at ${stepWhere}. Available methods: ${methods}.`
          );
        }
      }
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
