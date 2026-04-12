import { execSync } from "node:child_process";
import type { ProjectConfig, Scenario } from "./types.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are a QA engineer generating Playwright test scenarios for visual PR documentation.
Given a PR description or git diff, produce realistic user-facing scenarios that exercise the changed UI.

Each scenario should:
- Navigate to relevant pages
- Interact with changed elements (click, type, scroll)
- Include descriptive captions for each step (shown in screenshots/video)
- Cover both happy paths and edge cases visible in the diff

Respond with ONLY valid JSON matching this schema:
{
  "scenarios": [
    {
      "name": "string - short scenario name",
      "description": "string - what this scenario tests",
      "steps": [
        {
          "action": "navigate" | "click" | "type" | "wait" | "scroll" | "screenshot",
          "url": "string (for navigate)",
          "selector": "string (for click/type)",
          "value": "string (for type)",
          "duration": "number in ms (for wait)",
          "caption": "string - human-readable description of this step"
        }
      ]
    }
  ]
}`;

async function callClaudeAPI(prompt: string): Promise<Scenario[]> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY ??
    process.env.CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn(
      "ANTHROPIC_API_KEY not set — falling back to static scenarios"
    );
    return [];
  }

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
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`Claude API error (${response.status}): ${text}`);
    return [];
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock?.text) return [];

  try {
    const parsed = JSON.parse(textBlock.text) as { scenarios: Scenario[] };
    return parsed.scenarios;
  } catch {
    console.warn("Failed to parse Claude API response as JSON");
    return [];
  }
}

function getPRDescription(prNumber?: number): string | null {
  if (!prNumber) return null;
  try {
    return execSync(`gh pr view ${prNumber} --json body -q .body`, {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

function detectDefaultBranch(): string {
  // Try the remote HEAD symref first (works for any default branch name)
  try {
    const ref = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || git rev-parse --verify --quiet refs/remotes/origin/main 2>/dev/null && echo main || echo master",
      { encoding: "utf-8", timeout: 5_000 }
    ).trim();
    // symbolic-ref returns e.g. "refs/remotes/origin/main" — extract the branch name
    if (ref.startsWith("refs/remotes/origin/")) {
      return ref.replace("refs/remotes/origin/", "");
    }
    return ref;
  } catch {
    return "main";
  }
}

function getGitDiff(): string | null {
  try {
    const defaultBranch = detectDefaultBranch();
    const base = execSync(`git merge-base HEAD ${defaultBranch}`, {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    const diff = execSync(`git diff ${base}...HEAD -- '*.tsx' '*.jsx' '*.vue' '*.svelte' '*.html'`, {
      encoding: "utf-8",
      timeout: 30_000,
    });
    return diff.trim() || null;
  } catch {
    return null;
  }
}

function normalizeRoutes(
  config?: ProjectConfig
): Array<{ path: string; label: string }> {
  const raw = config?.routes;
  if (raw && raw.length > 0) {
    return raw.map((r) =>
      typeof r === "string" ? { path: r, label: r } : r
    );
  }
  // Fall back to readiness path (usually the real homepage for i18n sites),
  // then plain "/"
  const readinessPath = config?.readiness?.path;
  if (readinessPath && readinessPath !== "/") {
    return [{ path: readinessPath, label: readinessPath }];
  }
  return [{ path: "/", label: "Homepage" }];
}

function buildStaticScenarios(
  baseUrl: string,
  config?: ProjectConfig
): Scenario[] {
  const routes = normalizeRoutes(config);

  return routes.map((route) => ({
    name: route.label,
    description: `Capture ${route.label}`,
    steps: [
      {
        action: "navigate" as const,
        url: new URL(route.path, baseUrl).toString(),
        caption: `Navigate to ${route.label}`,
        pacing: "quick" as const,
      },
      {
        action: "wait" as const,
        duration: 2000,
        caption: "Wait for page to fully load",
        pacing: "quick" as const,
      },
      {
        action: "screenshot" as const,
        caption: `${route.label} — full page view`,
        pacing: "quick" as const,
      },
      {
        action: "scroll" as const,
        caption: "Scroll down to see more content",
        pacing: "quick" as const,
      },
      {
        action: "wait" as const,
        duration: 1000,
        caption: "Wait for lazy content to load",
        pacing: "quick" as const,
      },
      {
        action: "screenshot" as const,
        caption: `${route.label} — below the fold`,
        pacing: "quick" as const,
      },
    ],
  }));
}

export async function generateScenarios(
  baseUrl: string,
  prNumber?: number,
  prBody?: string,
  config?: ProjectConfig
): Promise<Scenario[]> {
  // 1. Try PR description
  const description = prBody ?? getPRDescription(prNumber);
  if (description && description.length > 20) {
    const scenarios = await callClaudeAPI(
      `Generate Playwright scenarios for this PR. Base URL: ${baseUrl}\n\nPR Description:\n${description}`
    );
    if (scenarios.length > 0) return scenarios;
  }

  // 2. Try git diff
  const diff = getGitDiff();
  if (diff && diff.length > 50) {
    const truncatedDiff = diff.slice(0, 12_000);
    const scenarios = await callClaudeAPI(
      `Generate Playwright scenarios based on this git diff. Base URL: ${baseUrl}\n\nDiff:\n${truncatedDiff}`
    );
    if (scenarios.length > 0) return scenarios;
  }

  // 3. Fall back to static scenarios using config routes
  console.log("Using static route-based scenarios");
  return buildStaticScenarios(baseUrl, config);
}
