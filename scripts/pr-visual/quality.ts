import {
  DEFAULT_DESKTOP_VIEWPORT,
  QUALITY_PRESETS,
  QUALITY_PRESET_NAMES,
  type ProjectConfig,
  type QualityPreset,
  type Scenario,
  type ViewportConfig,
} from "./types.js";

export const QUALITY_ENV_VAR = "PR_VISUAL_QUALITY";

function isQualityPreset(value: string): value is QualityPreset {
  return (QUALITY_PRESET_NAMES as string[]).includes(value);
}

function presetToViewport(preset: QualityPreset): ViewportConfig {
  const { width, height } = QUALITY_PRESETS[preset];
  return {
    name: "desktop",
    width,
    height,
    deviceScaleFactor: DEFAULT_DESKTOP_VIEWPORT.deviceScaleFactor,
  };
}

/**
 * Resolve the desktop viewport for a scenario.
 *
 * Precedence (highest to lowest):
 *   1. `PR_VISUAL_QUALITY` env var
 *   2. `scenario.quality`
 *   3. `scenario.viewport` (explicit override)
 *   4. `projectConfig.quality`
 *   5. Built-in default (1440x900 @2x)
 *
 * Mobile viewports are handled separately and are not affected by this
 * resolver.
 *
 * Throws on an unrecognised quality preset.
 */
export function resolveDesktopViewport(
  scenario: Pick<Scenario, "quality" | "viewport">,
  projectConfig: Pick<ProjectConfig, "quality"> | undefined,
  env: NodeJS.ProcessEnv = process.env
): ViewportConfig {
  const envValue = env[QUALITY_ENV_VAR];
  if (envValue !== undefined && envValue !== "") {
    if (!isQualityPreset(envValue)) {
      throw new Error(
        `Invalid ${QUALITY_ENV_VAR}="${envValue}". Must be one of: ${QUALITY_PRESET_NAMES.join(", ")}.`
      );
    }
    return presetToViewport(envValue);
  }

  if (scenario.quality !== undefined) {
    if (!isQualityPreset(scenario.quality)) {
      throw new Error(
        `Invalid scenario.quality="${scenario.quality}". Must be one of: ${QUALITY_PRESET_NAMES.join(", ")}.`
      );
    }
    return presetToViewport(scenario.quality);
  }

  if (scenario.viewport !== undefined) {
    const { width, height, deviceScaleFactor } = scenario.viewport;
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(
        `Invalid scenario.viewport.width=${width}. Must be a positive number.`
      );
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error(
        `Invalid scenario.viewport.height=${height}. Must be a positive number.`
      );
    }
    return {
      name: "desktop",
      width,
      height,
      deviceScaleFactor:
        deviceScaleFactor ?? DEFAULT_DESKTOP_VIEWPORT.deviceScaleFactor,
    };
  }

  if (projectConfig?.quality !== undefined) {
    if (!isQualityPreset(projectConfig.quality)) {
      throw new Error(
        `Invalid projectConfig.quality="${projectConfig.quality}". Must be one of: ${QUALITY_PRESET_NAMES.join(", ")}.`
      );
    }
    return presetToViewport(projectConfig.quality);
  }

  return { ...DEFAULT_DESKTOP_VIEWPORT };
}
