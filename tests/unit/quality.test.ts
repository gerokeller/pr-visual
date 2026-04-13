import { describe, it, expect } from "vitest";
import {
  QUALITY_ENV_VAR,
  resolveDesktopViewport,
} from "../../scripts/pr-visual/quality.js";
import {
  DEFAULT_DESKTOP_VIEWPORT,
  QUALITY_PRESETS,
  type ProjectConfig,
  type Scenario,
} from "../../scripts/pr-visual/types.js";

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: "test",
    description: "test",
    steps: [],
    ...overrides,
  };
}

describe("resolveDesktopViewport()", () => {
  describe("default", () => {
    it("returns built-in desktop viewport when nothing is set", () => {
      const viewport = resolveDesktopViewport(makeScenario(), undefined, {});
      expect(viewport).toEqual(DEFAULT_DESKTOP_VIEWPORT);
    });

    it("returns built-in desktop viewport when projectConfig has no quality", () => {
      const viewport = resolveDesktopViewport(makeScenario(), {}, {});
      expect(viewport).toEqual(DEFAULT_DESKTOP_VIEWPORT);
    });
  });

  describe("precedence chain", () => {
    it("uses projectConfig.quality when set (tier 4)", () => {
      const viewport = resolveDesktopViewport(
        makeScenario(),
        { quality: "720p" } as ProjectConfig,
        {}
      );
      expect(viewport.width).toBe(QUALITY_PRESETS["720p"].width);
      expect(viewport.height).toBe(QUALITY_PRESETS["720p"].height);
      expect(viewport.deviceScaleFactor).toBe(2);
    });

    it("scenario.viewport overrides projectConfig.quality (tier 3)", () => {
      const viewport = resolveDesktopViewport(
        makeScenario({ viewport: { width: 1024, height: 768 } }),
        { quality: "4k" } as ProjectConfig,
        {}
      );
      expect(viewport.width).toBe(1024);
      expect(viewport.height).toBe(768);
      expect(viewport.deviceScaleFactor).toBe(2);
    });

    it("scenario.viewport honors explicit deviceScaleFactor", () => {
      const viewport = resolveDesktopViewport(
        makeScenario({
          viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
        }),
        undefined,
        {}
      );
      expect(viewport.deviceScaleFactor).toBe(1);
    });

    it("scenario.quality overrides scenario.viewport (tier 2)", () => {
      const viewport = resolveDesktopViewport(
        makeScenario({
          quality: "1080p",
          viewport: { width: 1024, height: 768 },
        }),
        { quality: "720p" } as ProjectConfig,
        {}
      );
      expect(viewport.width).toBe(QUALITY_PRESETS["1080p"].width);
      expect(viewport.height).toBe(QUALITY_PRESETS["1080p"].height);
    });

    it("env var overrides everything (tier 1)", () => {
      const viewport = resolveDesktopViewport(
        makeScenario({
          quality: "720p",
          viewport: { width: 1024, height: 768 },
        }),
        { quality: "1080p" } as ProjectConfig,
        { [QUALITY_ENV_VAR]: "4k" }
      );
      expect(viewport.width).toBe(QUALITY_PRESETS["4k"].width);
      expect(viewport.height).toBe(QUALITY_PRESETS["4k"].height);
    });

    it("empty env var is treated as unset", () => {
      const viewport = resolveDesktopViewport(
        makeScenario({ quality: "720p" }),
        undefined,
        { [QUALITY_ENV_VAR]: "" }
      );
      expect(viewport.width).toBe(QUALITY_PRESETS["720p"].width);
    });
  });

  describe("presets produce documented resolutions", () => {
    it.each(
      Object.entries(QUALITY_PRESETS)
    )("%s resolves to %o", (preset, dims) => {
      const viewport = resolveDesktopViewport(
        makeScenario({ quality: preset as keyof typeof QUALITY_PRESETS }),
        undefined,
        {}
      );
      expect(viewport.width).toBe(dims.width);
      expect(viewport.height).toBe(dims.height);
      expect(viewport.deviceScaleFactor).toBe(2);
    });
  });

  describe("invalid input — hard fail", () => {
    it("throws on unrecognised env var value", () => {
      expect(() =>
        resolveDesktopViewport(makeScenario(), undefined, {
          [QUALITY_ENV_VAR]: "8k",
        })
      ).toThrowError(/Invalid PR_VISUAL_QUALITY="8k"/);
    });

    it("throws on unrecognised scenario.quality", () => {
      expect(() =>
        resolveDesktopViewport(
          makeScenario({ quality: "ultra" as never }),
          undefined,
          {}
        )
      ).toThrowError(/Invalid scenario\.quality="ultra"/);
    });

    it("throws on unrecognised projectConfig.quality", () => {
      expect(() =>
        resolveDesktopViewport(
          makeScenario(),
          { quality: "wat" as never } as unknown as ProjectConfig,
          {}
        )
      ).toThrowError(/Invalid projectConfig\.quality="wat"/);
    });

    it("throws on non-positive scenario.viewport width", () => {
      expect(() =>
        resolveDesktopViewport(
          makeScenario({ viewport: { width: 0, height: 768 } }),
          undefined,
          {}
        )
      ).toThrowError(/Invalid scenario\.viewport\.width/);
    });

    it("throws on non-positive scenario.viewport height", () => {
      expect(() =>
        resolveDesktopViewport(
          makeScenario({ viewport: { width: 1024, height: -1 } }),
          undefined,
          {}
        )
      ).toThrowError(/Invalid scenario\.viewport\.height/);
    });
  });
});
