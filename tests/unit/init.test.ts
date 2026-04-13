import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  ensureGitignoreEntries,
  initConfig,
} from "../../scripts/pr-visual/init.js";

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-init-test-"));
}

describe("initConfig()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a config file for a Next.js project", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
        scripts: { dev: "next dev" },
      })
    );

    await initConfig(tmpDir);

    const configPath = path.join(tmpDir, ".pr-visual.config.ts");
    expect(fs.existsSync(configPath)).toBe(true);

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain("next dev");
    expect(content).toContain("port: 3000");
    expect(content).toContain("npm ci");
  });

  it("detects Vite projects", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        devDependencies: { vite: "^5.0.0" },
        scripts: { dev: "vite" },
      })
    );

    await initConfig(tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, ".pr-visual.config.ts"),
      "utf-8"
    );
    expect(content).toContain("vite");
    expect(content).toContain("port: 5173");
  });

  it("detects pnpm package manager", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.js" } })
    );
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");

    await initConfig(tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, ".pr-visual.config.ts"),
      "utf-8"
    );
    expect(content).toContain("pnpm install --frozen-lockfile");
  });

  it("detects Docker services from compose file", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "npm start" } })
    );
    fs.writeFileSync(
      path.join(tmpDir, "docker-compose.yml"),
      `services:\n  postgres:\n    image: postgres:16\n  redis:\n    image: redis:7\n`
    );

    await initConfig(tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, ".pr-visual.config.ts"),
      "utf-8"
    );
    expect(content).toContain("docker compose up -d postgres redis");
    expect(content).toContain("docker compose down -v");
    expect(content).toContain("COMPOSE_PROJECT_NAME");
  });

  it("detects Prisma ORM and adds migration steps", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { next: "^14.0.0" },
        devDependencies: { prisma: "^5.0.0" },
        scripts: { dev: "next dev" },
      })
    );
    fs.mkdirSync(path.join(tmpDir, "prisma"));
    fs.writeFileSync(path.join(tmpDir, "prisma/schema.prisma"), "");

    await initConfig(tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, ".pr-visual.config.ts"),
      "utf-8"
    );
    expect(content).toContain("prisma migrate deploy");
    expect(content).toContain("prisma db seed");
  });

  it("does not overwrite an existing config", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "npm start" } })
    );
    const configPath = path.join(tmpDir, ".pr-visual.config.ts");
    fs.writeFileSync(configPath, "// existing config");

    await initConfig(tmpDir);

    expect(fs.readFileSync(configPath, "utf-8")).toBe("// existing config");
  });

  it("generates a minimal config when nothing is detected", async () => {
    // No package.json, no docker, no ORM
    await initConfig(tmpDir);

    const configPath = path.join(tmpDir, ".pr-visual.config.ts");
    expect(fs.existsSync(configPath)).toBe(true);

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain("devServer");
    expect(content).toContain("npm run dev");
    expect(content).toContain("npm ci");
  });

  it("appends .pr-visual/auth/ to .gitignore on first init", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "npm start" } })
    );
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");

    await initConfig(tmpDir);

    const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gi).toContain("node_modules/");
    expect(gi).toContain(".pr-visual/auth/");
  });
});

describe("ensureGitignoreEntries()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .gitignore when missing", () => {
    ensureGitignoreEntries(tmpDir, [".pr-visual/auth/"]);
    const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gi).toContain(".pr-visual/auth/");
  });

  it("does not duplicate entries that already exist", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gitignore"),
      "node_modules/\n.pr-visual/auth/\n"
    );
    ensureGitignoreEntries(tmpDir, [".pr-visual/auth/"]);
    const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gi.match(/\.pr-visual\/auth\//g)).toHaveLength(1);
  });

  it("appends only missing entries", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gitignore"),
      "node_modules/\n.pr-visual/auth/\n"
    );
    ensureGitignoreEntries(tmpDir, [".pr-visual/auth/", ".env.local"]);
    const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gi).toContain("node_modules/");
    expect(gi).toContain(".pr-visual/auth/");
    expect(gi).toContain(".env.local");
    expect(gi.match(/\.pr-visual\/auth\//g)).toHaveLength(1);
  });
});
