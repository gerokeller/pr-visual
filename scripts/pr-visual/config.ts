import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectConfig, RunContext } from "./types.js";

const CONFIG_FILENAMES = [
  ".pr-visual.config.ts",
  ".pr-visual.config.js",
  ".pr-visual.config.mjs",
];

export const DEFAULT_CONFIG: ProjectConfig = {
  baseUrl: "http://localhost:{{port}}",
  port: 3000,
  devServer: { command: "npm run dev" },
  outputDir: ".pr-visual",
  isolate: true,
  worktreeDir: "../.pr-visual-worktrees",
  installCommand: "npm ci",
};

/**
 * Locate the project config file by walking up from `startDir` to the repo
 * root (or filesystem root).
 */
function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);

  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    // Stop at git root or filesystem root
    if (fs.existsSync(path.join(dir, ".git")) || dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Dynamically import the project config file.
 * Supports both `export default { ... }` and `export const config = { ... }`.
 */
async function importConfig(filePath: string): Promise<ProjectConfig> {
  // tsx handles .ts imports at runtime
  const mod = (await import(filePath)) as {
    default?: ProjectConfig;
    config?: ProjectConfig;
  };
  const raw = mod.default ?? mod.config;
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `Config file ${filePath} must export a default or named "config" object`
    );
  }
  return raw;
}

/**
 * Load the project configuration.
 *
 * Resolution order:
 *  1. Explicit `configPath` argument
 *  2. Walk up from `projectRoot` looking for .pr-visual.config.{ts,js,mjs}
 *  3. Fall back to sensible defaults
 */
export async function loadProjectConfig(
  projectRoot: string,
  configPath?: string
): Promise<{ config: ProjectConfig; configDir: string }> {
  const resolved = configPath ?? findConfigFile(projectRoot);

  if (resolved && fs.existsSync(resolved)) {
    console.log(`  Config:   ${resolved}`);
    const userConfig = await importConfig(resolved);
    return {
      config: { ...DEFAULT_CONFIG, ...userConfig },
      configDir: path.dirname(path.resolve(resolved)),
    };
  }

  console.log("  Config:   using defaults (no .pr-visual.config found)");
  return {
    config: { ...DEFAULT_CONFIG },
    configDir: projectRoot,
  };
}

// ---------------------------------------------------------------------------
// Template substitution — replaces {{port}}, {{runId}}, {{rootDir}}
// ---------------------------------------------------------------------------

/**
 * Replace all template variables in a string.
 *
 *   {{port}}    → ctx.port
 *   {{runId}}   → ctx.runId
 *   {{rootDir}} → ctx.rootDir
 */
export function sub(template: string, ctx: RunContext): string {
  return template
    .replace(/\{\{port\}\}/g, String(ctx.port))
    .replace(/\{\{runId\}\}/g, ctx.runId)
    .replace(/\{\{rootDir\}\}/g, ctx.rootDir);
}

/**
 * Substitute all template variables in a Record of env vars.
 */
export function subEnv(
  env: Record<string, string> | undefined,
  ctx: RunContext
): Record<string, string> {
  if (!env) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = sub(v, ctx);
  }
  return result;
}

/**
 * Resolve the base URL from the project config + run context.
 */
export function resolveBaseUrl(
  config: ProjectConfig,
  ctx: RunContext
): string {
  const template = config.baseUrl ?? DEFAULT_CONFIG.baseUrl!;
  return sub(template, ctx);
}
