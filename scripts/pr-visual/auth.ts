import * as fs from "node:fs";
import * as path from "node:path";
import type { AuthConfig } from "./types.js";

export const AUTH_DIR_ENV_VAR = "PR_VISUAL_AUTH_DIR";
export const DEFAULT_AUTH_DIR = ".pr-visual/auth";

export interface ResolvedAuth {
  /** Absolute path to the directory storing storage state files. */
  storageStateDir: string;
  /** Absolute paths per profile name. */
  profilePaths: Record<string, string>;
}

/** Resolve the auth-dir + profile paths from project config + env var.
 *  Does not touch the filesystem; pure path resolution. */
export function resolveAuth(
  config: AuthConfig | undefined,
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): ResolvedAuth {
  const envOverride = env[AUTH_DIR_ENV_VAR];
  const dir =
    envOverride && envOverride !== ""
      ? envOverride
      : (config?.storageStateDir ?? DEFAULT_AUTH_DIR);
  const storageStateDir = path.isAbsolute(dir)
    ? dir
    : path.resolve(projectRoot, dir);

  const profilePaths: Record<string, string> = {};
  for (const [name, relPath] of Object.entries(config?.profiles ?? {})) {
    profilePaths[name] = path.isAbsolute(relPath)
      ? relPath
      : path.resolve(storageStateDir, relPath);
  }

  return { storageStateDir, profilePaths };
}

/** Look up a named profile and return the absolute storage state file path.
 *  Throws on unknown profile name or missing/unreadable file. */
export function resolveProfilePath(
  profile: string,
  resolved: ResolvedAuth
): string {
  const p = resolved.profilePaths[profile];
  if (!p) {
    const known = Object.keys(resolved.profilePaths);
    const knownStr = known.length ? known.join(", ") : "<none configured>";
    throw new Error(
      `Unknown auth profile "${profile}". Known profiles: ${knownStr}.`
    );
  }
  return p;
}

/** Verify each configured profile points at a readable JSON file. Used
 *  immediately after `tokenGenerator` has finished (or at startup when no
 *  generator is configured) so a silently-failing generator surfaces as a
 *  pre-capture error instead of a confusing Playwright failure later. */
export function validateStorageStates(resolved: ResolvedAuth): void {
  for (const [name, p] of Object.entries(resolved.profilePaths)) {
    if (!fs.existsSync(p)) {
      throw new Error(
        `Auth profile "${name}" storage state not found at ${p}. ` +
          `Did the tokenGenerator run successfully?`
      );
    }
    try {
      const raw = fs.readFileSync(p, "utf-8");
      JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Auth profile "${name}" storage state at ${p} is not valid JSON: ${msg}`
      );
    }
  }
}
