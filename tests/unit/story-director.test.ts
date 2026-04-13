import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyPersonaToScenarios,
  assertValidBrief,
  briefCacheKey,
  directBrief,
  formatBrief,
  formatNarrative,
  STORY_CACHE_DIR,
} from "../../scripts/pr-visual/story-director.js";
import { PERSONAS, type Brief } from "../../scripts/pr-visual/types.js";

const VALID_BRIEF: Brief = {
  narrative: {
    persona: "End User",
    setup: "A user opens the app expecting their dashboard.",
    incitingMoment: "They notice a new metric tile.",
    payoff: "Clicking the tile reveals a clearer breakdown.",
    closing: "Users get answers without leaving the dashboard.",
  },
  scenarios: [
    {
      name: "Inspect the new metric",
      description: "End-to-end exploration of the new tile.",
      persona: "End User",
      steps: [
        {
          action: "navigate",
          url: "/",
          caption: "Open the dashboard",
          beat: "setup",
        },
        {
          action: "click",
          selector: "#metric",
          caption: "Open the breakdown",
          beat: "action",
        },
        {
          action: "screenshot",
          caption: "See the result",
          beat: "payoff",
          emphasis: "strong",
        },
      ],
    },
  ],
};

describe("PERSONAS", () => {
  it("is the documented closed pool", () => {
    expect(PERSONAS).toEqual(["End User", "Admin", "New User", "Stakeholder"]);
  });
});

describe("briefCacheKey", () => {
  it("is stable for the same input", () => {
    expect(briefCacheKey({ prDescription: "x", diff: "y" })).toBe(
      briefCacheKey({ prDescription: "x", diff: "y" })
    );
  });

  it("changes when description or diff changes", () => {
    const base = briefCacheKey({ prDescription: "x", diff: "y" });
    expect(briefCacheKey({ prDescription: "x2", diff: "y" })).not.toBe(base);
    expect(briefCacheKey({ prDescription: "x", diff: "y2" })).not.toBe(base);
  });

  it("treats missing fields as empty string (no undefined collisions)", () => {
    expect(briefCacheKey({})).toBe(
      briefCacheKey({ prDescription: "", diff: "" })
    );
  });
});

describe("assertValidBrief", () => {
  it("accepts the canonical valid brief", () => {
    expect(() => assertValidBrief(VALID_BRIEF)).not.toThrow();
  });

  it("rejects a non-object", () => {
    expect(() => assertValidBrief(null)).toThrow(/must be an object/);
    expect(() => assertValidBrief("nope")).toThrow(/must be an object/);
  });

  it("rejects a missing narrative", () => {
    expect(() =>
      assertValidBrief({ scenarios: VALID_BRIEF.scenarios })
    ).toThrow(/narrative is required/);
  });

  it("rejects a persona outside the closed pool", () => {
    const bad = JSON.parse(JSON.stringify(VALID_BRIEF));
    bad.narrative.persona = "Hero";
    expect(() => assertValidBrief(bad)).toThrow(/persona must be one of/);
  });

  it.each([
    "setup",
    "incitingMoment",
    "payoff",
  ] as const)("rejects empty %s in the narrative", (key) => {
    const bad = JSON.parse(JSON.stringify(VALID_BRIEF));
    bad.narrative[key] = "";
    expect(() => assertValidBrief(bad)).toThrow(
      new RegExp(`narrative\\.${key}.*non-empty string`)
    );
  });

  it("rejects scenarios that are not an array", () => {
    expect(() =>
      assertValidBrief({ ...VALID_BRIEF, scenarios: "nope" })
    ).toThrow(/scenarios must be an array/);
  });

  it("rejects a scenario with empty steps", () => {
    const bad = JSON.parse(JSON.stringify(VALID_BRIEF));
    bad.scenarios[0].steps = [];
    expect(() => assertValidBrief(bad)).toThrow(/non-empty array/);
  });
});

describe("applyPersonaToScenarios", () => {
  it("backfills missing per-scenario persona from the narrative", () => {
    const brief: Brief = {
      narrative: { ...VALID_BRIEF.narrative },
      scenarios: VALID_BRIEF.scenarios.map((s) => {
        const { persona: _omit, ...rest } = s;
        return rest;
      }),
    };
    const out = applyPersonaToScenarios(brief);
    expect(out[0]!.persona).toBe(brief.narrative.persona);
  });

  it("preserves an explicit per-scenario persona", () => {
    const brief: Brief = {
      narrative: { ...VALID_BRIEF.narrative, persona: "Admin" },
      scenarios: [{ ...VALID_BRIEF.scenarios[0]!, persona: "Stakeholder" }],
    };
    const out = applyPersonaToScenarios(brief);
    expect(out[0]!.persona).toBe("Stakeholder");
  });
});

describe("formatNarrative / formatBrief", () => {
  it("formatNarrative includes every populated field", () => {
    const out = formatNarrative(VALID_BRIEF.narrative);
    expect(out).toContain("Persona:");
    expect(out).toContain("End User");
    expect(out).toContain("Setup:");
    expect(out).toContain("Inciting:");
    expect(out).toContain("Payoff:");
    expect(out).toContain("Closing:");
  });

  it("formatNarrative omits the optional closing line when absent", () => {
    const { closing: _omit, ...rest } = VALID_BRIEF.narrative;
    const out = formatNarrative(rest);
    expect(out).not.toContain("Closing:");
  });

  it("formatBrief renders scenarios + steps with beat labels", () => {
    const out = formatBrief(VALID_BRIEF);
    expect(out).toContain("Scenario 1: Inspect the new metric");
    expect(out).toContain("[setup]");
    expect(out).toContain("[action]");
    expect(out).toContain("[payoff]");
    // Strong emphasis is rendered with surrounding asterisks.
    expect(out).toMatch(/\*\*See the result\*\*/);
  });
});

describe("STORY_CACHE_DIR", () => {
  it("matches the documented default", () => {
    expect(STORY_CACHE_DIR).toBe(".pr-visual/story");
  });
});

describe("directBrief — caching + injectable callModel", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-story-"));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns null when no input is provided", async () => {
    const brief = await directBrief({});
    expect(brief).toBeNull();
  });

  it("returns null when no API key is available and no callModel is injected", async () => {
    const prevAnth = process.env.ANTHROPIC_API_KEY;
    const prevPlugin = process.env.CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY;
    try {
      const brief = await directBrief({
        prDescription: "A non-trivial PR description for the story director.",
      });
      expect(brief).toBeNull();
    } finally {
      if (prevAnth !== undefined) process.env.ANTHROPIC_API_KEY = prevAnth;
      if (prevPlugin !== undefined)
        process.env.CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY = prevPlugin;
    }
  });

  it("uses an injected callModel and validates the response", async () => {
    const brief = await directBrief({
      prDescription: "Add a metric tile to the dashboard.",
      callModel: async () => JSON.stringify(VALID_BRIEF),
      cacheDir,
    });
    expect(brief).not.toBeNull();
    expect(brief!.narrative.persona).toBe("End User");
  });

  it("writes to the cache and reuses it on the second call", async () => {
    let calls = 0;
    const callModel = async () => {
      calls++;
      return JSON.stringify(VALID_BRIEF);
    };
    await directBrief({
      prDescription: "Add a metric tile.",
      callModel,
      cacheDir,
    });
    await directBrief({
      prDescription: "Add a metric tile.",
      callModel,
      cacheDir,
    });
    expect(calls).toBe(1);
    // Cache file exists at the documented path.
    const files = fs.readdirSync(cacheDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^[0-9a-f]{16}\.json$/);
  });

  it("rejects malformed model JSON", async () => {
    await expect(
      directBrief({
        prDescription: "x".repeat(40),
        callModel: async () => "not json",
        cacheDir,
      })
    ).rejects.toThrow(/Story Director response was not valid JSON/);
  });

  it("rejects a syntactically valid but schema-invalid response", async () => {
    await expect(
      directBrief({
        prDescription: "x".repeat(40),
        callModel: async () =>
          JSON.stringify({ narrative: { persona: "Hero" }, scenarios: [] }),
        cacheDir,
      })
    ).rejects.toThrow(/persona must be one of/);
  });
});
