import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type Brief,
  type Narrative,
  PERSONAS,
  type Persona,
  type Scenario,
} from "./types.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

export const STORY_CACHE_DIR = ".pr-visual/story";

export const STORY_DIRECTOR_SYSTEM_PROMPT = `You are a Story Director crafting product-demo narratives for visual PR documentation.

Given a PR description and/or git diff, produce:
1. A three-act narrative arc (setup → inciting moment → payoff, plus an optional closing line) framed for one of these personas: ${PERSONAS.map((p) => `"${p}"`).join(", ")}.
2. One or more Playwright scenarios that ENACT that arc as a recorded demo.

Persona selection rules:
- "Admin" — settings, configuration, user management, billing, RBAC, integrations.
- "New User" — onboarding, first-run, signup, empty-state, getting-started flows.
- "Stakeholder" — read-only dashboards, reports, analytics, exec views.
- "End User" — default for everything else (everyday usage of the product's main flows).

Each scenario has:
- a short name
- a one-line description
- a "persona" field equal to the persona above
- a "steps" array; every step has:
  - "action": "navigate" | "click" | "type" | "wait" | "scroll" | "screenshot" | "highlight"
  - optional "selector" (for click/type/scroll/highlight) — plain CSS selector
  - optional "url" (for navigate, relative path is fine)
  - optional "value" (for type)
  - optional "duration" (ms, for wait/highlight)
  - "caption": one short sentence shown on screen and read aloud (5–14 words)
  - "beat": one of "setup" | "action" | "payoff" | "close" — match the narrative arc
  - optional "emphasis": "normal" | "strong" — use "strong" sparingly for the payoff moment
  - optional "pacing": "quick" | "normal" | "slow" | "dramatic" — default "normal"

Beats and emphasis distribution:
- Open with 1–2 "setup" beats so viewers orient.
- Drive the demo through 2–4 "action" beats.
- End with at least one "payoff" beat and "emphasis": "strong" so the punchline lands.
- Optional "close" beat for the takeaway.

Respond with ONLY valid JSON (no prose, no markdown fences) matching:
{
  "narrative": {
    "persona": "End User" | "Admin" | "New User" | "Stakeholder",
    "setup": "string — one sentence",
    "incitingMoment": "string — one sentence",
    "payoff": "string — one sentence",
    "closing": "string — optional, one sentence"
  },
  "scenarios": [
    {
      "name": "string",
      "description": "string",
      "persona": "<same as narrative.persona>",
      "steps": [/* as described above */]
    }
  ]
}`;

export interface DirectBriefArgs {
  prDescription?: string | null;
  diff?: string | null;
  baseUrl?: string;
  /** Override the API key probe (useful for tests). */
  apiKey?: string;
  /** Cache directory; absolute path. When set, brief responses are cached
   *  by content hash so re-runs are free. */
  cacheDir?: string;
  /** Override the network call (useful for tests). When set, the function
   *  feeds the prompt to this callable instead of hitting the API. */
  callModel?: (prompt: string) => Promise<string>;
}

/** Stable hash for the brief cache: keyed by the prompt content so any
 *  change in description or diff invalidates. */
export function briefCacheKey(input: {
  prDescription?: string | null;
  diff?: string | null;
}): string {
  const payload = JSON.stringify({
    description: input.prDescription ?? "",
    diff: input.diff ?? "",
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function readBriefCache(cacheDir: string, key: string): Brief | null {
  const p = path.join(cacheDir, `${key}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Brief;
    assertValidBrief(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeBriefCache(cacheDir: string, key: string, brief: Brief): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, `${key}.json`),
    JSON.stringify(brief, null, 2)
  );
}

function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && (PERSONAS as string[]).includes(value);
}

/** Hard-fails on a malformed brief so the CLI surfaces a clear error before
 *  feeding the result downstream. */
export function assertValidBrief(value: unknown): asserts value is Brief {
  if (!value || typeof value !== "object") {
    throw new Error("Brief must be an object.");
  }
  const v = value as Record<string, unknown>;
  if (!v.narrative || typeof v.narrative !== "object") {
    throw new Error("Brief.narrative is required.");
  }
  const n = v.narrative as Record<string, unknown>;
  if (!isPersona(n.persona)) {
    throw new Error(
      `Brief.narrative.persona must be one of: ${PERSONAS.join(", ")}.`
    );
  }
  for (const k of ["setup", "incitingMoment", "payoff"] as const) {
    if (typeof n[k] !== "string" || (n[k] as string).trim() === "") {
      throw new Error(`Brief.narrative.${k} must be a non-empty string.`);
    }
  }
  if (!Array.isArray(v.scenarios)) {
    throw new Error("Brief.scenarios must be an array.");
  }
  for (let i = 0; i < v.scenarios.length; i++) {
    const s = v.scenarios[i] as Record<string, unknown>;
    if (typeof s.name !== "string" || s.name.trim() === "") {
      throw new Error(`Brief.scenarios[${i}].name must be a non-empty string.`);
    }
    if (!Array.isArray(s.steps) || s.steps.length === 0) {
      throw new Error(`Brief.scenarios[${i}].steps must be a non-empty array.`);
    }
  }
}

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: STORY_DIRECTOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Claude API error (${response.status}): ${await response.text()}`
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content.find((b) => b.type === "text");
  const text = textBlock?.text;
  if (!text) {
    throw new Error("Claude API response missing a text block.");
  }
  return text;
}

function buildPrompt(args: DirectBriefArgs): string {
  const parts: string[] = [];
  if (args.baseUrl) parts.push(`Base URL: ${args.baseUrl}`);
  if (args.prDescription && args.prDescription.length > 0) {
    parts.push(`PR description:\n${args.prDescription}`);
  }
  if (args.diff && args.diff.length > 0) {
    // Truncate the diff to keep the prompt under the model's context budget.
    const truncated = args.diff.slice(0, 12_000);
    parts.push(`Git diff (truncated):\n${truncated}`);
  }
  parts.push(
    "Direct a narrative arc and the scenarios that enact it. Respond with the JSON shape from the system prompt only."
  );
  return parts.join("\n\n");
}

/** Direct a narrative + scenarios from a PR description and/or diff.
 *
 *  When `cacheDir` is set, briefs are cached by content hash. When neither
 *  description nor diff is supplied, returns null so callers can fall back. */
export async function directBrief(
  args: DirectBriefArgs
): Promise<Brief | null> {
  const hasInput =
    (args.prDescription && args.prDescription.length > 0) ||
    (args.diff && args.diff.length > 0);
  if (!hasInput) return null;

  if (args.cacheDir) {
    const key = briefCacheKey(args);
    const cached = readBriefCache(args.cacheDir, key);
    if (cached) {
      console.log("[story] cache hit");
      return cached;
    }
  }

  const apiKey =
    args.apiKey ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY;

  const callModel =
    args.callModel ??
    (apiKey ? (prompt: string) => callClaude(prompt, apiKey) : null);

  if (!callModel) {
    return null; // Caller falls back to static scenarios.
  }

  const text = await callModel(buildPrompt(args));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Story Director response was not valid JSON: ${msg}`);
  }
  assertValidBrief(parsed);

  if (args.cacheDir) {
    const key = briefCacheKey(args);
    writeBriefCache(args.cacheDir, key, parsed);
  }

  return parsed;
}

/** Render a narrative arc as a small human-readable block for the CLI. */
export function formatNarrative(narrative: Narrative): string {
  const lines = [
    `Persona:   ${narrative.persona}`,
    `Setup:     ${narrative.setup}`,
    `Inciting:  ${narrative.incitingMoment}`,
    `Payoff:    ${narrative.payoff}`,
  ];
  if (narrative.closing) {
    lines.push(`Closing:   ${narrative.closing}`);
  }
  return lines.join("\n");
}

/** Render a brief (narrative + scenario step list) for the CLI. */
export function formatBrief(brief: Brief): string {
  const sections = [formatNarrative(brief.narrative), ""];
  for (let i = 0; i < brief.scenarios.length; i++) {
    const s = brief.scenarios[i]!;
    sections.push(`Scenario ${i + 1}: ${s.name}`);
    sections.push(`  ${s.description}`);
    for (let j = 0; j < s.steps.length; j++) {
      const step = s.steps[j]!;
      const beat = step.beat ? `[${step.beat}] ` : "";
      const emph = step.emphasis === "strong" ? "**" : "";
      sections.push(`    ${j + 1}. ${beat}${emph}${step.caption}${emph}`);
    }
    sections.push("");
  }
  return sections.join("\n");
}

/** Apply the persona from the brief's narrative onto every scenario the
 *  director returned. The system prompt asks for it but defensive copy
 *  guarantees consistency. */
export function applyPersonaToScenarios(brief: Brief): Scenario[] {
  return brief.scenarios.map((s) => ({
    ...s,
    persona: s.persona ?? brief.narrative.persona,
  }));
}
