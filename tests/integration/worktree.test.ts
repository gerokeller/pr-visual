import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  findAvailablePort,
  createWorktree,
  removeWorktree,
  listActiveWorktrees,
  copyArtifacts,
  getRepoRoot,
} from "../../scripts/pr-visual/worktree.js";
import type { ProjectConfig } from "../../scripts/pr-visual/types.js";

// Create a temporary git repo for worktree tests
let testRepoDir: string;

beforeAll(() => {
  testRepoDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pr-visual-wt-test-")
  );
  execSync("git init", { cwd: testRepoDir, stdio: "pipe" });
  execSync("git config user.email test@test.com", {
    cwd: testRepoDir,
    stdio: "pipe",
  });
  execSync("git config user.name Test", {
    cwd: testRepoDir,
    stdio: "pipe",
  });
  fs.writeFileSync(path.join(testRepoDir, "file.txt"), "hello");
  execSync("git add . && git commit -m 'init'", {
    cwd: testRepoDir,
    stdio: "pipe",
  });
});

afterAll(() => {
  // Clean up all worktrees first
  try {
    execSync("git worktree prune", { cwd: testRepoDir, stdio: "pipe" });
  } catch {
    // ignore
  }
  fs.rmSync(testRepoDir, { recursive: true, force: true });
});

describe("findAvailablePort()", () => {
  it("finds an available port", async () => {
    const port = await findAvailablePort(40000);
    expect(port).toBeGreaterThanOrEqual(40000);
    expect(port).toBeLessThan(40100);
  });

  it("returns different ports when called concurrently", async () => {
    // Start a server on a port to force the second call to find a different one
    const net = await import("node:net");
    const server = net.createServer();
    const port1 = await findAvailablePort(41000);
    await new Promise<void>((resolve) => {
      server.listen(port1, "127.0.0.1", () => resolve());
    });

    try {
      const port2 = await findAvailablePort(41000);
      expect(port2).not.toBe(port1);
      expect(port2).toBeGreaterThan(port1);
    } finally {
      server.close();
    }
  });
});

describe("createWorktree() / removeWorktree()", () => {
  const config: ProjectConfig = {
    devServer: { command: "echo ok" },
    worktreeDir: "../.pr-visual-test-worktrees",
    port: 42000,
  };

  it("creates a worktree and removes it cleanly", async () => {
    const wt = await createWorktree(config, testRepoDir);

    // Worktree directory should exist
    expect(fs.existsSync(wt.rootDir)).toBe(true);

    // Should contain the repo files
    expect(fs.existsSync(path.join(wt.rootDir, "file.txt"))).toBe(true);

    // runId should be in the path
    expect(wt.rootDir).toContain(wt.runId);

    // Branch should exist
    const branches = execSync("git branch", {
      cwd: testRepoDir,
      encoding: "utf-8",
    });
    expect(branches).toContain(wt.branch);

    // Port should be allocated
    expect(wt.port).toBeGreaterThanOrEqual(42000);

    // Now remove it
    removeWorktree(wt, testRepoDir);

    // Directory should be gone
    expect(fs.existsSync(wt.rootDir)).toBe(false);
  });

  it("removeWorktree is safe to call twice", async () => {
    const wt = await createWorktree(config, testRepoDir);
    removeWorktree(wt, testRepoDir);
    // Second call should not throw
    expect(() => removeWorktree(wt, testRepoDir)).not.toThrow();
  });
});

describe("listActiveWorktrees()", () => {
  const config: ProjectConfig = {
    devServer: { command: "echo ok" },
    worktreeDir: "../.pr-visual-test-worktrees-list",
    port: 43000,
  };

  it("lists pr-visual worktrees", async () => {
    const wt = await createWorktree(config, testRepoDir);

    try {
      const active = listActiveWorktrees(testRepoDir);
      expect(active.some((p) => p.includes("pr-visual-"))).toBe(true);
    } finally {
      removeWorktree(wt, testRepoDir);
    }
  });
});

describe("copyArtifacts()", () => {
  it("recursively copies files", () => {
    const src = fs.mkdtempSync(
      path.join(os.tmpdir(), "pr-visual-copy-src-")
    );
    const dest = path.join(os.tmpdir(), `pr-visual-copy-dest-${Date.now()}`);

    // Create nested structure
    fs.mkdirSync(path.join(src, "sub"), { recursive: true });
    fs.writeFileSync(path.join(src, "a.txt"), "aaa");
    fs.writeFileSync(path.join(src, "sub/b.txt"), "bbb");

    copyArtifacts(src, dest);

    expect(fs.readFileSync(path.join(dest, "a.txt"), "utf-8")).toBe("aaa");
    expect(fs.readFileSync(path.join(dest, "sub/b.txt"), "utf-8")).toBe("bbb");

    // Cleanup
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });
});
