import { execSync } from "node:child_process";
import * as path from "node:path";
import {
  applyPersonaToScenarios,
  directBrief,
  STORY_CACHE_DIR,
} from "./story-director.js";
import type { ProjectConfig, Scenario } from "./types.js";

export function getPRDescription(prNumber?: number): string | null {
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

export function getGitDiff(): string | null {
  try {
    const defaultBranch = detectDefaultBranch();
    const base = execSync(`git merge-base HEAD ${defaultBranch}`, {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    const diff = execSync(
      `git diff ${base}...HEAD -- '*.tsx' '*.jsx' '*.vue' '*.svelte' '*.html'`,
      {
        encoding: "utf-8",
        timeout: 30_000,
      }
    );
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
    return raw.map((r) => (typeof r === "string" ? { path: r, label: r } : r));
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

export interface GenerateScenariosOptions {
  prNumber?: number;
  prBody?: string;
  config?: ProjectConfig;
  /** Project root (used for the Story Director's brief cache). */
  projectRoot?: string;
}

/** Generate scenarios for the current run. AI path delegates to the Story
 *  Director (which produces a narrative arc + scenarios with `persona`
 *  and per-step `beat`/`emphasis`); static path captures the configured
 *  routes when no API key is available. */
export async function generateScenarios(
  baseUrl: string,
  prNumberOrOpts?: number | GenerateScenariosOptions,
  prBody?: string,
  config?: ProjectConfig
): Promise<Scenario[]> {
  // Support both legacy positional args and a single options bag.
  const opts: GenerateScenariosOptions =
    typeof prNumberOrOpts === "object" && prNumberOrOpts !== null
      ? prNumberOrOpts
      : {
          ...(prNumberOrOpts !== undefined ? { prNumber: prNumberOrOpts } : {}),
          ...(prBody !== undefined ? { prBody } : {}),
          ...(config !== undefined ? { config } : {}),
        };

  const description = opts.prBody ?? getPRDescription(opts.prNumber);
  const diff = getGitDiff();

  const usefulDescription =
    description && description.length > 20 ? description : null;
  const usefulDiff = diff && diff.length > 50 ? diff : null;

  if (usefulDescription || usefulDiff) {
    try {
      const cacheDir = opts.projectRoot
        ? path.resolve(opts.projectRoot, STORY_CACHE_DIR)
        : undefined;
      const brief = await directBrief({
        ...(usefulDescription ? { prDescription: usefulDescription } : {}),
        ...(usefulDiff ? { diff: usefulDiff } : {}),
        baseUrl,
        ...(cacheDir ? { cacheDir } : {}),
      });
      if (brief) {
        return applyPersonaToScenarios(brief);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[story] director failed: ${msg}`);
      console.warn("[story] falling back to static scenarios");
    }
  }

  console.log("Using static route-based scenarios");
  return buildStaticScenarios(baseUrl, opts.config);
}
