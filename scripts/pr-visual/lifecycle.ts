import { execSync, spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { sub, subEnv } from "./config.js";
import type {
  LifecycleStep,
  DevServerConfig,
  ReadinessConfig,
  ProjectConfig,
  RunContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// Setup & teardown — sequential shell commands
// ---------------------------------------------------------------------------

/**
 * Build the environment for a lifecycle step.
 *
 * Automatically injects `COMPOSE_PROJECT_NAME` set to the run ID so that
 * every `docker compose` command scopes containers, networks, and volumes
 * to this run. The config can override this by setting the variable
 * explicitly in `step.env`.
 */
function buildStepEnv(
  step: LifecycleStep,
  ctx: RunContext
): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    // Auto-scope Docker resources to this run
    COMPOSE_PROJECT_NAME: ctx.runId,
    // Expose context as plain env vars too (useful in shell scripts)
    PR_VISUAL_RUN_ID: ctx.runId,
    PR_VISUAL_PORT: String(ctx.port),
    PR_VISUAL_ROOT_DIR: ctx.rootDir,
    // User overrides win
    ...subEnv(step.env, ctx),
  };
}

function runStep(step: LifecycleStep, ctx: RunContext): void {
  const cwd = step.cwd ? path.resolve(ctx.rootDir, step.cwd) : ctx.rootDir;
  const command = sub(step.command, ctx);
  const timeout = step.timeout ?? 120_000;
  const env = buildStepEnv(step, ctx);

  console.log(`    → ${step.name}: ${command}`);
  execSync(command, { cwd, stdio: "pipe", timeout, env });
}

export function runSetupSteps(steps: LifecycleStep[], ctx: RunContext): void {
  if (steps.length === 0) return;
  console.log("  Running setup steps...");
  for (const step of steps) {
    runStep(step, ctx);
  }
  console.log("  Setup complete");
}

export function runTeardownSteps(
  steps: LifecycleStep[],
  ctx: RunContext
): void {
  if (steps.length === 0) return;
  console.log("  Running teardown steps...");
  for (const step of steps) {
    try {
      runStep(step, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`    ⚠ Teardown step "${step.name}" failed: ${msg}`);
    }
  }
  console.log("  Teardown complete");
}

// ---------------------------------------------------------------------------
// Dev server — long-running background process
// ---------------------------------------------------------------------------

export function startDevServer(
  config: DevServerConfig,
  ctx: RunContext
): ChildProcess {
  const cwd = config.cwd ? path.resolve(ctx.rootDir, config.cwd) : ctx.rootDir;
  const command = sub(config.command, ctx);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(ctx.port),
    COMPOSE_PROJECT_NAME: ctx.runId,
    PR_VISUAL_RUN_ID: ctx.runId,
    PR_VISUAL_PORT: String(ctx.port),
    PR_VISUAL_ROOT_DIR: ctx.rootDir,
    ...subEnv(config.env, ctx),
  };

  console.log(`  Dev server: ${command} (port ${ctx.port})`);
  const [cmd, ...args] = command.split(" ");
  const child = spawn(cmd!, args, {
    cwd,
    stdio: "pipe",
    shell: true,
    detached: true,
    env,
  });

  // Collect stderr for diagnostics on failure
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.warn(`  Dev server exited with code ${code}`);
      if (stderr) console.warn(`  stderr: ${stderr.slice(-500)}`);
    }
  });

  child.unref();
  return child;
}

/**
 * Kill a dev server process and its entire process group.
 */
export function stopDevServer(child: ChildProcess): void {
  try {
    if (child.pid) {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    // Process might already be dead
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Fallback — already dead
  }
}

// ---------------------------------------------------------------------------
// Readiness probe
// ---------------------------------------------------------------------------

async function probeUrl(url: string, expectedStatus: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(3_000),
      headers: { Accept: "text/html" },
    });
    return response.status === expectedStatus;
  } catch {
    return false;
  }
}

export async function waitForReady(
  baseUrl: string,
  readiness: ReadinessConfig
): Promise<boolean> {
  const probePath = readiness.path ?? "/";
  const url = new URL(probePath, baseUrl).toString();
  const expectedStatus = readiness.status ?? 200;
  const timeout = readiness.timeout ?? 45_000;
  const interval = readiness.interval ?? 1_000;

  console.log(
    `  Readiness: probing ${url} for status ${expectedStatus} (timeout ${timeout / 1000}s)`
  );

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await probeUrl(url, expectedStatus)) {
      console.log("  Readiness: server is ready");
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  console.error("  Readiness: server did not become ready in time");
  return false;
}

export async function isAlreadyRunning(baseUrl: string): Promise<boolean> {
  return probeUrl(baseUrl, 200).catch(() => false);
}

// ---------------------------------------------------------------------------
// Full lifecycle orchestrator
// ---------------------------------------------------------------------------

export interface LifecycleHandle {
  devServer: ChildProcess | null;
  cleanup: () => void;
}

export async function bringUp(
  config: ProjectConfig,
  ctx: RunContext,
  baseUrl: string
): Promise<LifecycleHandle> {
  if (await isAlreadyRunning(baseUrl)) {
    console.log("  Server already running — skipping setup & dev server");
    return {
      devServer: null,
      cleanup: () => {
        runTeardownSteps(config.teardown ?? [], ctx);
      },
    };
  }

  runSetupSteps(config.setup ?? [], ctx);

  // Auth token generator runs between setup and dev server. Lets apps refresh
  // Playwright storage state (e.g., via Supabase admin API) before captures
  // start.
  if (config.auth?.tokenGenerator) {
    console.log("  Running auth token generator...");
    runStep(config.auth.tokenGenerator, ctx);
    console.log("  Auth token generator complete");
  }

  const devServer = startDevServer(config.devServer, ctx);

  const ready = await waitForReady(baseUrl, config.readiness ?? {});
  if (!ready) {
    stopDevServer(devServer);
    runTeardownSteps(config.teardown ?? [], ctx);
    throw new Error("Dev server did not become ready in time");
  }

  return {
    devServer,
    cleanup: () => {
      stopDevServer(devServer);
      runTeardownSteps(config.teardown ?? [], ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Signal-safe cleanup registration
// ---------------------------------------------------------------------------

type CleanupFn = () => void;
const cleanupStack: CleanupFn[] = [];
let signalHandlersInstalled = false;

/**
 * Register a cleanup function that will execute on SIGINT / SIGTERM.
 * Functions run in LIFO order (most recently registered first).
 * Returns an unregister function.
 */
export function onExit(fn: CleanupFn): () => void {
  cleanupStack.push(fn);
  installSignalHandlers();
  return () => {
    const idx = cleanupStack.indexOf(fn);
    if (idx !== -1) cleanupStack.splice(idx, 1);
  };
}

function runAllCleanups(): void {
  while (cleanupStack.length > 0) {
    const fn = cleanupStack.pop()!;
    try {
      fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Cleanup error: ${msg}`);
    }
  }
}

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const handler = (signal: string) => {
    console.log(`\npr-visual: Received ${signal} — cleaning up...`);
    runAllCleanups();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}
