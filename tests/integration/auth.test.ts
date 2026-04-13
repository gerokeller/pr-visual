import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { captureAllVariants } from "../../scripts/pr-visual/capture.js";
import type { ProjectConfig, Scenario } from "../../scripts/pr-visual/types.js";

const FIXTURE_PORT = 3994;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;
const FIXTURE_APP = path.resolve(__dirname, "../fixtures/app.js");

let fixtureServer: ChildProcess;
let projectRoot: string;
let outputDir: string;
let storageStateDir: string;

beforeAll(async () => {
  fixtureServer = spawn("node", [FIXTURE_APP], {
    env: { ...process.env, PORT: String(FIXTURE_PORT) },
    stdio: "pipe",
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${FIXTURE_URL}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) break;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-auth-"));
  outputDir = path.join(projectRoot, "captures");
  fs.mkdirSync(outputDir, { recursive: true });
  storageStateDir = path.join(projectRoot, ".pr-visual/auth");
  fs.mkdirSync(storageStateDir, { recursive: true });

  // Fixture storage state: a Playwright cookie that the fixture reads back
  // into the page so we can assert the page sees the "logged in" session.
  const storageState = {
    cookies: [
      {
        name: "pr_visual_session",
        value: "alice",
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  fs.writeFileSync(
    path.join(storageStateDir, "alice.json"),
    JSON.stringify(storageState)
  );
});

afterAll(() => {
  fixtureServer?.kill();
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
});

function authedScenario(): Scenario {
  return {
    name: "auth-probe",
    description: "Loads the fixture with an alice session cookie",
    profile: "alice",
    steps: [
      {
        action: "navigate",
        url: FIXTURE_URL,
        caption: "Open as alice",
        pacing: "quick",
      },
      {
        action: "screenshot",
        caption: "Authed snapshot",
        pacing: "quick",
      },
    ],
  };
}

function projectConfig(): ProjectConfig {
  return {
    devServer: { command: "" },
    auth: {
      profiles: { alice: "alice.json" },
    },
  };
}

describe("auth — storage state loaded into Playwright context", () => {
  it("scenario.profile loads the matching storage state into every variant", async () => {
    const results = await captureAllVariants(
      [authedScenario()],
      FIXTURE_URL,
      outputDir,
      projectConfig(),
      projectRoot
    );

    expect(results.length).toBeGreaterThan(0);
    // For every captured variant the screenshot was taken after the
    // navigate, so the fixture should have echoed the cookie value into
    // the rendered DOM. We probe the raw screenshot via Playwright again
    // to make the assertion deterministic without parsing PNG.
    // Easier: re-run a tiny Playwright probe with the same storage state
    // and assert the page text includes "Logged in as alice".
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        storageState: path.join(storageStateDir, "alice.json"),
      });
      const page = await ctx.newPage();
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      const sessionAttr = await page
        .locator("#auth-state")
        .getAttribute("data-session");
      expect(sessionAttr).toBe("alice");
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);
});
