import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getRepoRoot, listActiveWorktrees, removeWorktree } from "./worktree.js";
import { loadProjectConfig } from "./config.js";
import type { WorktreeContext } from "./types.js";

// ---------------------------------------------------------------------------
// Orphaned Docker resource cleanup
// ---------------------------------------------------------------------------

/**
 * List Docker containers whose project name starts with "pr-visual-".
 * Returns container IDs grouped by project name.
 */
function findOrphanedDockerProjects(): Map<string, string[]> {
  const projects = new Map<string, string[]>();
  try {
    const output = execSync(
      'docker ps -a --filter "label=com.docker.compose.project" --format "{{.ID}} {{.Labels}}"',
      { encoding: "utf-8", timeout: 10_000 }
    );
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      const [id, ...labels] = line.split(" ");
      const labelStr = labels.join(" ");
      const projectMatch = labelStr.match(
        /com\.docker\.compose\.project=([^\s,]+)/
      );
      if (projectMatch && projectMatch[1]!.startsWith("pr-visual-")) {
        const project = projectMatch[1]!;
        if (!projects.has(project)) projects.set(project, []);
        projects.get(project)!.push(id!);
      }
    }
  } catch {
    // Docker might not be installed or running
  }
  return projects;
}

/**
 * Tear down a Docker Compose project by name.
 */
function removeDockerProject(projectName: string): void {
  try {
    execSync(`docker compose -p ${JSON.stringify(projectName)} down -v --remove-orphans`, {
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch {
    // Try force-removing containers individually
    try {
      const ids = execSync(
        `docker ps -a --filter "label=com.docker.compose.project=${projectName}" -q`,
        { encoding: "utf-8", timeout: 5_000 }
      ).trim();
      if (ids) {
        execSync(`docker rm -f ${ids.split("\n").join(" ")}`, {
          stdio: "pipe",
          timeout: 10_000,
        });
      }
    } catch {
      // Best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Worktree-to-context conversion
// ---------------------------------------------------------------------------

function worktreePathToContext(worktreePath: string): WorktreeContext {
  const dirName = path.basename(worktreePath);
  return {
    rootDir: worktreePath,
    branch: `pr-visual/${dirName}`,
    port: 0, // Unknown — not needed for cleanup
    runId: dirName,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function cleanupOrphans(projectRoot?: string): Promise<void> {
  const repoRoot = projectRoot ?? getRepoRoot();

  console.log("pr-visual cleanup: Scanning for orphaned resources...\n");

  // 1. Find and remove orphaned worktrees
  const worktrees = listActiveWorktrees(repoRoot);
  if (worktrees.length > 0) {
    console.log(`  Found ${worktrees.length} orphaned worktree(s):`);
    for (const wt of worktrees) {
      console.log(`    → ${wt}`);
      const ctx = worktreePathToContext(wt);
      removeWorktree(ctx, repoRoot);
      console.log(`      Removed`);
    }
  } else {
    console.log("  No orphaned worktrees found");
  }

  // 2. Find and remove orphaned Docker projects
  const dockerProjects = findOrphanedDockerProjects();
  if (dockerProjects.size > 0) {
    console.log(
      `\n  Found ${dockerProjects.size} orphaned Docker project(s):`
    );
    for (const [project, containers] of dockerProjects) {
      console.log(`    → ${project} (${containers.length} container(s))`);
      removeDockerProject(project);
      console.log(`      Removed`);
    }
  } else {
    console.log("  No orphaned Docker projects found");
  }

  // 3. Clean up stale worktree parent directory
  const { config } = await loadProjectConfig(repoRoot);
  const worktreeParent = path.resolve(
    repoRoot,
    config.worktreeDir ?? "../.pr-visual-worktrees"
  );
  if (fs.existsSync(worktreeParent)) {
    const entries = fs.readdirSync(worktreeParent);
    const stale = entries.filter((e) => e.startsWith("pr-visual-"));
    if (stale.length > 0) {
      console.log(`\n  Found ${stale.length} stale worktree directory(ies):`);
      for (const dir of stale) {
        const fullPath = path.join(worktreeParent, dir);
        console.log(`    → ${fullPath}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`      Removed`);
      }
    }

    // Remove parent if now empty
    const remaining = fs.readdirSync(worktreeParent);
    if (remaining.length === 0) {
      fs.rmdirSync(worktreeParent);
      console.log(`\n  Removed empty worktree directory: ${worktreeParent}`);
    }
  }

  // 4. Prune git worktree refs
  try {
    execSync("git worktree prune", { cwd: repoRoot, stdio: "pipe", timeout: 5_000 });
  } catch {
    // Non-critical
  }

  console.log("\npr-visual cleanup: Done");
}
