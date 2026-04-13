import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  runSetupSteps,
  runTeardownSteps,
  onExit,
} from "../../scripts/pr-visual/lifecycle.js";
import type {
  LifecycleStep,
  RunContext,
} from "../../scripts/pr-visual/types.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-lc-test-"));
}

function makeCtx(rootDir: string): RunContext {
  return {
    runId: "test-run-123",
    port: 9999,
    rootDir,
  };
}

describe("runSetupSteps()", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes steps in order", () => {
    tmpDir = makeTmpDir();
    const ctx = makeCtx(tmpDir);
    const marker = path.join(tmpDir, "setup-order.txt");

    const steps: LifecycleStep[] = [
      { name: "Step 1", command: `echo step1 >> ${marker}` },
      { name: "Step 2", command: `echo step2 >> ${marker}` },
      { name: "Step 3", command: `echo step3 >> ${marker}` },
    ];

    runSetupSteps(steps, ctx);

    const content = fs.readFileSync(marker, "utf-8").trim();
    expect(content).toBe("step1\nstep2\nstep3");
  });

  it("substitutes template variables in commands", () => {
    tmpDir = makeTmpDir();
    const ctx = makeCtx(tmpDir);
    const marker = path.join(tmpDir, "templates.txt");

    const steps: LifecycleStep[] = [
      {
        name: "Template test",
        command: `echo "port={{port}} runId={{runId}}" > ${marker}`,
      },
    ];

    runSetupSteps(steps, ctx);

    const content = fs.readFileSync(marker, "utf-8").trim();
    expect(content).toBe("port=9999 runId=test-run-123");
  });

  it("injects COMPOSE_PROJECT_NAME into env", () => {
    tmpDir = makeTmpDir();
    const ctx = makeCtx(tmpDir);
    const marker = path.join(tmpDir, "compose-env.txt");

    const steps: LifecycleStep[] = [
      {
        name: "Env check",
        command: `echo $COMPOSE_PROJECT_NAME > ${marker}`,
      },
    ];

    runSetupSteps(steps, ctx);

    const content = fs.readFileSync(marker, "utf-8").trim();
    expect(content).toBe("test-run-123");
  });

  it("user env overrides auto-injected env", () => {
    tmpDir = makeTmpDir();
    const ctx = makeCtx(tmpDir);
    const marker = path.join(tmpDir, "env-override.txt");

    const steps: LifecycleStep[] = [
      {
        name: "Override test",
        command: `echo $COMPOSE_PROJECT_NAME > ${marker}`,
        env: { COMPOSE_PROJECT_NAME: "custom-project" },
      },
    ];

    runSetupSteps(steps, ctx);

    const content = fs.readFileSync(marker, "utf-8").trim();
    expect(content).toBe("custom-project");
  });

  it("throws on step failure", () => {
    tmpDir = makeTmpDir();
    const ctx = makeCtx(tmpDir);

    const steps: LifecycleStep[] = [{ name: "Will fail", command: "exit 1" }];

    expect(() => runSetupSteps(steps, ctx)).toThrow();
  });

  it("skips with empty array", () => {
    tmpDir = makeTmpDir();
    const ctx = makeCtx(tmpDir);
    expect(() => runSetupSteps([], ctx)).not.toThrow();
  });
});

describe("runTeardownSteps()", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("continues executing after a failing step", () => {
    tmpDir = makeTmpDir();
    const ctx = makeCtx(tmpDir);
    const marker = path.join(tmpDir, "teardown.txt");

    const steps: LifecycleStep[] = [
      { name: "Will fail", command: "exit 1" },
      { name: "Should still run", command: `echo survived > ${marker}` },
    ];

    runTeardownSteps(steps, ctx);

    expect(fs.readFileSync(marker, "utf-8").trim()).toBe("survived");
  });
});

describe("onExit()", () => {
  it("returns an unregister function", () => {
    let called = false;
    const unregister = onExit(() => {
      called = true;
    });
    // Unregister before it can fire
    unregister();
    // If we got here without error, it worked
    expect(called).toBe(false);
  });
});
