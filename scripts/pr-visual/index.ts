import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateScenarios,
  getGitDiff,
  getPRDescription,
} from "./scenario-generator.js";
import { STORY_CACHE_DIR, directBrief, formatBrief } from "./story-director.js";
import { validateScenarios } from "./scenario-validator.js";
import { resolveAuth, validateStorageStates } from "./auth.js";
import { loadPomModules } from "./pom.js";
import { DEFAULT_CACHE_DIR, generateVoiceOver } from "./voiceover.js";
import { captureAllVariants } from "./capture.js";
import { annotateScreenshots } from "./annotate/screenshots.js";
import { burnCaptions } from "./annotate/video.js";
import { composeVideo } from "./compositing/index.js";
import { runMobilePass } from "./mobile-pass.js";
import { patchPRBodyWithScreenshots, addVideoComment } from "./pr-attach.js";
import { loadProjectConfig, resolveBaseUrl } from "./config.js";
import {
  createWorktree,
  installDependencies,
  removeWorktree,
  copyArtifacts,
  getRepoRoot,
  findAvailablePort,
} from "./worktree.js";
import { bringUp, onExit, type LifecycleHandle } from "./lifecycle.js";
import { initConfig } from "./init.js";
import { cleanupOrphans } from "./cleanup.js";
import type { RuntimeConfig, RunContext, WorktreeContext } from "./types.js";

// ---------------------------------------------------------------------------
// PR detection
// ---------------------------------------------------------------------------

function detectPRNumber(cwd?: string): number | undefined {
  try {
    const output = execSync("gh pr view --json number -q .number", {
      encoding: "utf-8",
      timeout: 10_000,
      cwd,
    }).trim();
    return parseInt(output, 10) || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// CLI routing
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  switch (subcommand) {
    case "init":
      await initConfig(getRepoRoot());
      return;

    case "cleanup":
      await cleanupOrphans();
      return;

    case "story":
      await runStoryCommand(argv.slice(1));
      return;

    case "run":
    case undefined:
      await run();
      return;

    default:
      console.error(`Unknown command: ${subcommand}`);
      console.error("Usage: pr-visual [run | init | cleanup | story]");
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// `story` subcommand
// ---------------------------------------------------------------------------

interface StoryCommandOptions {
  pr?: number;
  scaffold: boolean;
  json: boolean;
}

function parseStoryArgs(args: string[]): StoryCommandOptions {
  const opts: StoryCommandOptions = { scaffold: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--scaffold") {
      opts.scaffold = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--pr") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("--pr requires a number");
      }
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(`--pr expects a number, got "${value}"`);
      }
      opts.pr = parsed;
      i++;
    } else {
      throw new Error(`Unknown option for \`story\`: ${arg}`);
    }
  }
  return opts;
}

export async function runStoryCommand(args: string[]): Promise<void> {
  const opts = parseStoryArgs(args);
  const repoRoot = getRepoRoot();
  const prNumber = opts.pr ?? detectPRNumber(repoRoot);

  const description = getPRDescription(prNumber);
  const diff = getGitDiff();

  const usefulDescription =
    description && description.length > 20 ? description : null;
  const usefulDiff = diff && diff.length > 50 ? diff : null;

  if (!usefulDescription && !usefulDiff) {
    console.error(
      "[story] No PR description and no useful diff found — nothing to direct."
    );
    process.exit(1);
  }

  const cacheDir = path.resolve(repoRoot, STORY_CACHE_DIR);
  const brief = await directBrief({
    ...(usefulDescription ? { prDescription: usefulDescription } : {}),
    ...(usefulDiff ? { diff: usefulDiff } : {}),
    cacheDir,
  });

  if (!brief) {
    console.error(
      "[story] No API key (set ANTHROPIC_API_KEY) — Story Director is unavailable."
    );
    process.exit(1);
  }

  if (opts.scaffold) {
    const scaffoldPath = path.resolve(
      repoRoot,
      ".pr-visual/story-scaffold.json"
    );
    fs.mkdirSync(path.dirname(scaffoldPath), { recursive: true });
    fs.writeFileSync(scaffoldPath, JSON.stringify(brief, null, 2));
    console.log(`Scaffold written: ${scaffoldPath}`);
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(brief, null, 2) + "\n");
    return;
  }

  process.stdout.write(formatBrief(brief) + "\n");
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const repoRoot = getRepoRoot();
  const prBody = process.env.PR_BODY;
  const configPath = process.env.PR_VISUAL_CONFIG;
  const noIsolate = process.env.PR_VISUAL_NO_ISOLATE === "1";

  // 1. Load project config
  console.log("pr-visual: Loading configuration");
  const { config: projectConfig, configDir } = await loadProjectConfig(
    repoRoot,
    configPath
  );

  if (noIsolate) projectConfig.isolate = false;

  const prNumber = detectPRNumber(repoRoot);
  if (prNumber) console.log(`  PR:       #${prNumber}`);

  // 2. Set up isolation (worktree) or run in-place
  let worktree: WorktreeContext | null = null;
  let runCtx: RunContext;

  if (projectConfig.isolate !== false) {
    console.log("\n[env] Creating isolated worktree...");
    worktree = await createWorktree(projectConfig, repoRoot);

    runCtx = {
      runId: worktree.runId,
      port: worktree.port,
      rootDir: worktree.rootDir,
    };

    // Register cleanup for SIGINT/SIGTERM — worktree removal runs even on crash
    onExit(() => {
      console.log("[cleanup] Removing worktree...");
      removeWorktree(worktree!, repoRoot);
    });

    console.log("\n[env] Installing dependencies in worktree...");
    installDependencies(worktree, projectConfig);
  } else {
    console.log("\n[env] Running in-place (no isolation)");
    const port = await findAvailablePort(projectConfig.port ?? 3000);
    const runId = `pr-visual-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    runCtx = {
      runId,
      port,
      rootDir: configDir,
    };

    console.log(`  Run ID:   ${runCtx.runId}`);
    console.log(`  Port:     ${runCtx.port}`);
  }

  const baseUrl = resolveBaseUrl(projectConfig, runCtx);
  const outputDir = path.resolve(
    runCtx.rootDir,
    projectConfig.outputDir ?? ".pr-visual"
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const runtime: RuntimeConfig = {
    baseUrl,
    outputDir,
    prNumber,
    prBody,
    project: projectConfig,
    worktree,
  };

  console.log(`  Base URL: ${runtime.baseUrl}`);
  console.log(`  Output:   ${runtime.outputDir}`);

  // 3. Bring up the environment (setup → dev server → readiness)
  let lifecycle: LifecycleHandle | null = null;

  try {
    console.log("\n[env] Starting application...");
    lifecycle = await bringUp(projectConfig, runCtx, baseUrl);

    // Register lifecycle cleanup for SIGINT/SIGTERM
    onExit(() => {
      console.log("[cleanup] Tearing down environment...");
      lifecycle!.cleanup();
    });

    // 4. Generate scenarios
    console.log("\n[1/4] Generating scenarios...");
    const scenarios = await generateScenarios(runtime.baseUrl, {
      ...(runtime.prNumber !== undefined ? { prNumber: runtime.prNumber } : {}),
      ...(runtime.prBody !== undefined ? { prBody: runtime.prBody } : {}),
      config: runtime.project,
      projectRoot: runCtx.rootDir,
    });
    // Eagerly load POM modules so `validateScenarios` can check both the
    // `page` name and the `method` name before capture starts.
    const loadedPoms = loadPomModules(runtime.project.poms, runCtx.rootDir);
    validateScenarios(scenarios, {
      ...(runtime.project.auth ? { auth: runtime.project.auth } : {}),
      poms: loadedPoms,
    });
    console.log(`  Generated ${scenarios.length} scenario(s)`);

    // Verify configured auth profiles point at readable JSON storage state
    // files. Done here (after lifecycle's tokenGenerator has run, before
    // capture) so a silently-failing generator surfaces immediately.
    const scenariosUseAuth = scenarios.some((s) => s.profile !== undefined);
    if (scenariosUseAuth && runtime.project.auth) {
      const resolved = resolveAuth(runtime.project.auth, runCtx.rootDir);
      validateStorageStates(resolved);
    }

    // 5. Capture screenshots and video
    console.log("\n[2/4] Capturing screenshots and video...");
    const results = await captureAllVariants(
      scenarios,
      runtime.baseUrl,
      runtime.outputDir,
      runtime.project,
      runCtx.rootDir,
      loadedPoms
    );
    const totalScreenshots = results.reduce(
      (n, r) => n + r.screenshots.length,
      0
    );
    console.log(
      `  Captured ${totalScreenshots} screenshots across ${results.length} variants`
    );

    // 6. Annotate screenshots
    console.log("\n[3/4] Annotating screenshots...");
    const annotated = await annotateScreenshots(results);
    console.log(`  Annotated ${annotated.length} screenshots`);

    // 6b. Burn captions into videos
    const captionedVideos: string[] = [];
    for (const result of results) {
      if (result.videoPath) {
        const videoWidth =
          result.viewport.width * result.viewport.deviceScaleFactor;
        const videoHeight =
          result.viewport.height * result.viewport.deviceScaleFactor;
        const captionedPath = await burnCaptions(
          result.videoPath,
          result.captions,
          videoWidth,
          videoHeight
        );
        captionedVideos.push(captionedPath);
      }
    }
    if (captionedVideos.length > 0) {
      console.log(`  Captioned ${captionedVideos.length} video(s)`);
    }

    // 6c. Optional Remotion compositing — desktop+light variant only.
    // `mobile.enabled` implies `compositing` is on.
    let compositedVideoPath: string | null = null;
    const mobileEnabled = runtime.project.video?.mobile?.enabled === true;
    const voiceOverEnabled = runtime.project.voiceover?.enabled === true;
    const compositingEnabled =
      runtime.project.video?.compositing === "remotion" ||
      mobileEnabled ||
      voiceOverEnabled;
    if (compositingEnabled) {
      console.log("\n[3b/4] Compositing video (Remotion)...");
      if (mobileEnabled) {
        console.log(
          "  Mobile composite enabled — wall-clock cost is ~1.8x desktop-only."
        );
      }
      const heroResult = results.find(
        (r) => r.viewport.name === "desktop" && r.colorScheme === "light"
      );
      if (!heroResult) {
        console.warn(
          "  No desktop+light variant captured — skipping compositing."
        );
      } else {
        const heroIndex = results.indexOf(heroResult);
        const heroCaptioned = captionedVideos[heroIndex];
        if (!heroCaptioned) {
          console.warn(
            "  Captioned MP4 missing for desktop+light — skipping compositing."
          );
        } else {
          const heroScenario =
            scenarios.find((s) => s.name === heroResult.captions[0]?.text) ??
            scenarios[0]!;

          // Optional mobile companion pass — fail closed: if it errors,
          // abort compositing entirely so the user knows the composite
          // didn't include the mobile stream.
          let mobilePass: Awaited<ReturnType<typeof runMobilePass>> | null =
            null;
          let mobileFailed = false;
          if (mobileEnabled) {
            try {
              console.log("  Running mobile composite pass...");
              const mobileStoragePath =
                heroScenario.profile && runtime.project.auth
                  ? resolveAuth(runtime.project.auth, runCtx.rootDir)
                      .profilePaths[heroScenario.profile]
                  : undefined;
              mobilePass = await runMobilePass(
                heroScenario,
                runtime.baseUrl,
                runtime.outputDir,
                runtime.project,
                mobileStoragePath,
                loadedPoms
              );
            } catch (err) {
              mobileFailed = true;
              console.error("  Mobile composite pass failed:", err);
              console.error(
                "  Aborting compositing — captioned MP4 stays as the final artifact."
              );
            }
          }

          // Optional voice-over generation — produces per-step MP3 clips
          // that the compositor mixes into the final MP4.
          let voClips: Awaited<ReturnType<typeof generateVoiceOver>>["clips"] =
            [];
          if (voiceOverEnabled) {
            try {
              console.log("  Generating voice-over...");
              const cacheDir = path.resolve(
                runCtx.rootDir,
                runtime.project.voiceover?.cacheDir ?? DEFAULT_CACHE_DIR
              );
              const res = await generateVoiceOver({
                texts: heroScenario.steps.map((s) => s.caption ?? null),
                cacheDir,
                ...(runtime.project.voiceover?.provider
                  ? { provider: runtime.project.voiceover.provider }
                  : {}),
                ...(runtime.project.voiceover?.voice
                  ? { voice: runtime.project.voiceover.voice }
                  : {}),
              });
              voClips = res.clips;
            } catch (err) {
              console.error("  Voice-over generation failed:", err);
              console.error(
                "  Continuing without voice-over; composited MP4 will be silent."
              );
            }
          }

          if (!mobileFailed) {
            const compose = await composeVideo({
              project: runtime.project,
              sourceVideoPath: heroCaptioned,
              outputDir: path.dirname(heroCaptioned),
              result: heroResult,
              scenario: heroScenario,
              ...(mobilePass
                ? {
                    mobile: {
                      videoPath: mobilePass.videoPath,
                      width: mobilePass.width,
                      height: mobilePass.height,
                      layout: mobilePass.layout,
                    },
                  }
                : {}),
              ...(voClips.length > 0
                ? {
                    voiceOverClips: voClips.map((c) => ({
                      path: c.path,
                      stepIndex: c.stepIndex,
                      durationSec: c.durationSec,
                    })),
                  }
                : {}),
            });
            if (compose.outputPath) {
              compositedVideoPath = compose.outputPath;
              console.log(`  Composited: ${path.basename(compose.outputPath)}`);
            }
          }
        }
      }
    }

    // 7. Copy artifacts back to the main repo if using worktree
    if (worktree) {
      const mainOutputDir = path.resolve(
        repoRoot,
        projectConfig.outputDir ?? ".pr-visual"
      );
      console.log(`\n[artifacts] Copying to ${mainOutputDir}`);
      copyArtifacts(runtime.outputDir, mainOutputDir);

      for (const a of annotated) {
        a.path = a.path.replace(worktree.rootDir, repoRoot);
      }
      for (let i = 0; i < captionedVideos.length; i++) {
        captionedVideos[i] = captionedVideos[i]!.replace(
          worktree.rootDir,
          repoRoot
        );
      }
      if (compositedVideoPath) {
        compositedVideoPath = compositedVideoPath.replace(
          worktree.rootDir,
          repoRoot
        );
      }
    }

    // 8. Attach to PR
    if (runtime.prNumber) {
      console.log("\n[4/4] Attaching to PR...");
      patchPRBodyWithScreenshots(runtime.prNumber, annotated, repoRoot);

      // Prefer the composited MP4 for the desktop+light slot when available;
      // fall back to the captioned MP4 for every other variant.
      const heroIndex = results.findIndex(
        (r) => r.viewport.name === "desktop" && r.colorScheme === "light"
      );
      for (let i = 0; i < captionedVideos.length; i++) {
        const videoPath =
          i === heroIndex && compositedVideoPath
            ? compositedVideoPath
            : captionedVideos[i]!;
        const label =
          i === heroIndex && compositedVideoPath
            ? "desktop-light (composited)"
            : path.basename(path.dirname(videoPath));
        addVideoComment(runtime.prNumber, videoPath, label);
      }
    } else {
      console.log("\n[4/4] No PR detected — skipping PR attachment");
      const finalOutput = worktree
        ? path.resolve(repoRoot, projectConfig.outputDir ?? ".pr-visual")
        : runtime.outputDir;
      console.log(`  Screenshots saved to: ${finalOutput}`);
    }

    console.log("\npr-visual: Done!");
  } finally {
    // Explicit cleanup (signal handler is a safety net for interrupts)
    if (lifecycle) {
      console.log("\n[cleanup] Tearing down environment...");
      lifecycle.cleanup();
    }
    if (worktree) {
      console.log("[cleanup] Removing worktree...");
      removeWorktree(worktree, repoRoot);
    }
  }
}

main().catch((err) => {
  console.error("pr-visual failed:", err);
  process.exit(1);
});
