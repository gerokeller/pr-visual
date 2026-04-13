import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PROVIDER_ORDER,
  clipFilename,
  detectProvider,
  generateVoiceOver,
  hashText,
  isProviderAvailable,
} from "../../scripts/pr-visual/voiceover.js";
import type { TtsProviderName } from "../../scripts/pr-visual/types.js";

const FIXTURE_MP3 = path.resolve(
  __dirname,
  "../fixtures/audio/silence-500ms.mp3"
);

describe("hashText", () => {
  it("is stable for the same (text, provider)", () => {
    expect(hashText("hello", "say")).toBe(hashText("hello", "say"));
  });

  it("changes when the provider changes", () => {
    expect(hashText("hello", "say")).not.toBe(hashText("hello", "openai"));
  });

  it("changes when the text changes", () => {
    expect(hashText("hello", "say")).not.toBe(hashText("world", "say"));
  });

  it("returns a 12-char hex prefix", () => {
    expect(hashText("hello", "say")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("clipFilename", () => {
  it("produces the documented step-NN-<hash>.mp3 shape", () => {
    expect(clipFilename(0, "hello", "say")).toMatch(
      /^step-00-[0-9a-f]{12}\.mp3$/
    );
    expect(clipFilename(7, "hello", "say")).toMatch(
      /^step-07-[0-9a-f]{12}\.mp3$/
    );
  });
});

describe("PROVIDER_ORDER", () => {
  it("is piper → google → openai → say", () => {
    expect([...PROVIDER_ORDER]).toEqual(["piper", "google", "openai", "say"]);
  });
});

describe("isProviderAvailable / detectProvider", () => {
  const prevKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  it("openai availability tracks the OPENAI_API_KEY env var", () => {
    delete process.env.OPENAI_API_KEY;
    expect(isProviderAvailable("openai")).toBe(false);
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isProviderAvailable("openai")).toBe(true);
  });

  it("detectProvider returns some provider name, or null", () => {
    const p = detectProvider();
    if (p !== null) {
      expect(PROVIDER_ORDER).toContain(p);
    }
  });
});

describe("generateVoiceOver — cache hit", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-tts-"));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("reuses an existing cached clip and never re-synthesizes", async () => {
    const provider: TtsProviderName = "say";
    const text = "Hello world";
    const expectedFile = path.join(cacheDir, clipFilename(0, text, provider));
    // Pre-seed the cache with the fixture silent MP3.
    fs.copyFileSync(FIXTURE_MP3, expectedFile);

    const res = await generateVoiceOver({
      texts: [text],
      cacheDir,
      provider,
    });

    expect(res.provider).toBe("say");
    expect(res.clips).toHaveLength(1);
    expect(res.clips[0]!.stepIndex).toBe(0);
    expect(res.clips[0]!.path).toBe(expectedFile);
    expect(res.clips[0]!.durationSec).toBeGreaterThan(0);
  }, 15_000);

  it("skips steps with empty or whitespace-only captions", async () => {
    // With explicit provider "say" the generator would call `say`, but an
    // empty text short-circuits before synthesis — so no real TTS runs.
    const res = await generateVoiceOver({
      texts: ["", null, "   ", undefined],
      cacheDir,
      provider: "say",
    });
    expect(res.clips).toHaveLength(0);
  });

  it("cache-key changes when provider changes so re-runs re-synthesize", () => {
    // Same text, different providers → different filenames so a provider
    // switch invalidates the cache.
    const a = clipFilename(0, "hello", "piper");
    const b = clipFilename(0, "hello", "openai");
    expect(a).not.toBe(b);
  });
});
