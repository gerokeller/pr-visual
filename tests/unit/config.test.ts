import { describe, it, expect } from "vitest";
import {
  sub,
  subEnv,
  resolveBaseUrl,
  DEFAULT_CONFIG,
  loadProjectConfig,
} from "../../scripts/pr-visual/config.js";
import type { RunContext } from "../../scripts/pr-visual/types.js";

const CTX: RunContext = {
  runId: "pr-visual-1713000000000-abc123",
  port: 4567,
  rootDir: "/tmp/worktree-test",
};

describe("sub()", () => {
  it("replaces {{port}}", () => {
    expect(sub("http://localhost:{{port}}", CTX)).toBe(
      "http://localhost:4567"
    );
  });

  it("replaces {{runId}}", () => {
    expect(sub("project-{{runId}}", CTX)).toBe(
      "project-pr-visual-1713000000000-abc123"
    );
  });

  it("replaces {{rootDir}}", () => {
    expect(sub("{{rootDir}}/output", CTX)).toBe("/tmp/worktree-test/output");
  });

  it("replaces all variables in one string", () => {
    const result = sub(
      "cd {{rootDir}} && PORT={{port}} COMPOSE_PROJECT_NAME={{runId}} npm start",
      CTX
    );
    expect(result).toBe(
      "cd /tmp/worktree-test && PORT=4567 COMPOSE_PROJECT_NAME=pr-visual-1713000000000-abc123 npm start"
    );
  });

  it("replaces multiple occurrences of the same variable", () => {
    expect(sub("{{port}}-{{port}}", CTX)).toBe("4567-4567");
  });

  it("leaves strings without placeholders unchanged", () => {
    expect(sub("npm run dev", CTX)).toBe("npm run dev");
  });
});

describe("subEnv()", () => {
  it("returns empty object for undefined env", () => {
    expect(subEnv(undefined, CTX)).toEqual({});
  });

  it("substitutes values in all entries", () => {
    const env = {
      PORT: "{{port}}",
      DB_NAME: "myapp_{{runId}}",
      STATIC: "unchanged",
    };
    expect(subEnv(env, CTX)).toEqual({
      PORT: "4567",
      DB_NAME: "myapp_pr-visual-1713000000000-abc123",
      STATIC: "unchanged",
    });
  });
});

describe("resolveBaseUrl()", () => {
  it("uses config baseUrl template with port substitution", () => {
    const config = { ...DEFAULT_CONFIG, baseUrl: "http://app:{{port}}/prefix" };
    expect(resolveBaseUrl(config, CTX)).toBe("http://app:4567/prefix");
  });

  it("falls back to default baseUrl when config has none", () => {
    const config = { ...DEFAULT_CONFIG, baseUrl: undefined };
    expect(resolveBaseUrl(config, CTX)).toBe("http://localhost:4567");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_CONFIG.port).toBe(3000);
    expect(DEFAULT_CONFIG.baseUrl).toBe("http://localhost:{{port}}");
    expect(DEFAULT_CONFIG.isolate).toBe(true);
    expect(DEFAULT_CONFIG.installCommand).toBe("npm ci");
    expect(DEFAULT_CONFIG.outputDir).toBe(".pr-visual");
    expect(DEFAULT_CONFIG.devServer.command).toBe("npm run dev");
  });
});

describe("loadProjectConfig()", () => {
  it("returns defaults when no config file exists", async () => {
    const { config, configDir } = await loadProjectConfig("/tmp/nonexistent");
    expect(config.port).toBe(3000);
    expect(config.devServer.command).toBe("npm run dev");
    expect(configDir).toBe("/tmp/nonexistent");
  });
});
