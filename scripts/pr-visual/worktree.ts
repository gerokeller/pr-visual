import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { ProjectConfig, WorktreeContext } from "./types.js";

/**
 * Find an available TCP port starting from `preferred`.
 * Tries up to 100 ports sequentially to avoid collisions between parallel runs.
 */
export async function findAvailablePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 100; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error(
    `No available port found in range ${preferred}–${preferred + 99}`
  );
}

/**
 * Get the root of the current git repository.
 */
export function getRepoRoot(cwd?: string): string {
  return execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
    cwd,
    timeout: 5_000,
  }).trim();
}

/**
 * Get the current branch or HEAD ref.
 */
function getCurrentRef(cwd?: string): string {
  try {
    return execSync("git symbolic-ref --short HEAD", {
      encoding: "utf-8",
      cwd,
      timeout: 5_000,
    }).trim();
  } catch {
    // Detached HEAD — use the commit SHA
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
      cwd,
      timeout: 5_000,
    }).trim();
  }
}

/**
 * Create an isolated git worktree for a pr-visual run.
 *
 * - Each run gets a unique ID based on timestamp + random suffix
 * - The worktree is created on a detached HEAD at the same commit
 * - Port is auto-allocated starting from the configured preferred port
 * - The worktree directory is placed outside the repo to avoid nesting
 */
export async function createWorktree(
  config: ProjectConfig,
  repoRoot: string
): Promise<WorktreeContext> {
  const runId = `pr-visual-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const currentRef = getCurrentRef(repoRoot);

  // Resolve worktree parent directory (outside the repo)
  const worktreeParent = path.resolve(
    repoRoot,
    config.worktreeDir ?? "../.pr-visual-worktrees"
  );
  fs.mkdirSync(worktreeParent, { recursive: true });

  const worktreeRoot = path.join(worktreeParent, runId);
  const branch = `pr-visual/${runId}`;

  // Create the worktree with a new branch at the current HEAD
  console.log(`  Worktree: ${worktreeRoot}`);
  execSync(
    `git worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(worktreeRoot)} HEAD`,
    {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 30_000,
    }
  );

  // Allocate a port
  const preferredPort = config.port ?? 3000;
  const port = await findAvailablePort(preferredPort);
  console.log(`  Port:     ${port} (preferred: ${preferredPort})`);

  return {
    rootDir: worktreeRoot,
    branch,
    port,
    runId,
  };
}

/**
 * Install project dependencies inside the worktree.
 */
export function installDependencies(
  worktree: WorktreeContext,
  config: ProjectConfig
): void {
  const command = config.installCommand ?? "npm ci";
  console.log(`  Install:  ${command}`);
  execSync(command, {
    cwd: worktree.rootDir,
    stdio: "pipe",
    timeout: 300_000, // 5 min for large installs
    env: { ...process.env, CI: "true" },
  });
}

/**
 * Remove a worktree and its tracking branch.
 * Safe to call multiple times — ignores errors if already cleaned up.
 */
export function removeWorktree(
  worktree: WorktreeContext,
  repoRoot: string
): void {
  try {
    execSync(
      `git worktree remove --force ${JSON.stringify(worktree.rootDir)}`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        timeout: 15_000,
      }
    );
  } catch {
    // Worktree might already be removed — clean up the directory manually
    if (fs.existsSync(worktree.rootDir)) {
      fs.rmSync(worktree.rootDir, { recursive: true, force: true });
    }
  }

  // Delete the temporary branch
  try {
    execSync(`git branch -D ${JSON.stringify(worktree.branch)}`, {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 5_000,
    });
  } catch {
    // Branch might not exist if worktree creation partially failed
  }

  // Prune stale worktree references
  try {
    execSync("git worktree prune", {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 5_000,
    });
  } catch {
    // Non-critical
  }
}

/**
 * Copy output artifacts from the worktree back to the main repo.
 */
export function copyArtifacts(
  worktreeOutputDir: string,
  mainOutputDir: string
): void {
  if (!fs.existsSync(worktreeOutputDir)) return;

  fs.mkdirSync(mainOutputDir, { recursive: true });

  // Recursively copy all files
  const entries = fs.readdirSync(worktreeOutputDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(worktreeOutputDir, entry.name);
    const dest = path.join(mainOutputDir, entry.name);
    if (entry.isDirectory()) {
      copyArtifacts(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

/**
 * List all active pr-visual worktrees (for diagnostics / cleanup).
 */
export function listActiveWorktrees(repoRoot: string): string[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      encoding: "utf-8",
      cwd: repoRoot,
      timeout: 5_000,
    });
    return output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.replace("worktree ", ""))
      .filter((p) => p.includes("pr-visual-"));
  } catch {
    return [];
  }
}
