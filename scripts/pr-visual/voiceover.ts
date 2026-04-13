import { execFile, execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TtsProviderName } from "./types.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_CACHE_DIR = ".pr-visual/tts";

/** Detection order — matches demo-recorder. First available wins. */
export const PROVIDER_ORDER: readonly TtsProviderName[] = [
  "piper",
  "google",
  "openai",
  "say",
] as const;

export interface TtsClip {
  /** Scenario step index this clip belongs to (0-based). */
  stepIndex: number;
  /** Absolute path to the generated MP3. */
  path: string;
  /** Duration of the generated audio in seconds. */
  durationSec: number;
}

export interface GenerateOptions {
  /** Per-step narration texts (aligned 1:1 with scenario steps). Falsy
   *  entries are skipped — a step with no caption gets no audio. */
  texts: (string | null | undefined)[];
  /** Cache directory (absolute). Clips are written here as
   *  `step-<idx>-<hash>.mp3`. */
  cacheDir: string;
  /** Explicit provider override. When omitted, auto-detects. */
  provider?: TtsProviderName;
  /** Provider-specific voice name. */
  voice?: string;
}

export interface GenerateResult {
  /** Provider that actually ran (null when detection failed). */
  provider: TtsProviderName | null;
  clips: TtsClip[];
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

function binExists(bin: string): boolean {
  const result = spawnSync("which", [bin], { stdio: "ignore" });
  return result.status === 0;
}

function hasGcloudAuth(): boolean {
  if (!binExists("gcloud")) return false;
  const result = spawnSync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
  );
  return result.status === 0 && result.stdout.toString().trim().length > 0;
}

/** Resolve the path to a Piper voice model. Honors `PIPER_MODEL` env var,
 *  otherwise looks in `~/.cache/piper/voices/*.onnx`. */
export function piperModelPath(): string | undefined {
  const envPath = process.env.PIPER_MODEL;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const cacheDir = path.join(os.homedir(), ".cache", "piper", "voices");
  if (!fs.existsSync(cacheDir)) return undefined;
  const onnx = fs
    .readdirSync(cacheDir)
    .find((f) => f.endsWith(".onnx") && !f.endsWith(".onnx.json"));
  return onnx ? path.join(cacheDir, onnx) : undefined;
}

/** Return `true` if the named provider is available right now. Pure
 *  function given env/platform state; useful for selective unit tests. */
export function isProviderAvailable(provider: TtsProviderName): boolean {
  switch (provider) {
    case "piper":
      return binExists("piper") && piperModelPath() !== undefined;
    case "google":
      return hasGcloudAuth();
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "say":
      return process.platform === "darwin" && binExists("say");
  }
}

/** First available provider in detection order, or null if none are. */
export function detectProvider(): TtsProviderName | null {
  for (const p of PROVIDER_ORDER) {
    if (isProviderAvailable(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Stable content hash used as the cache filename suffix. Keyed by
 *  `provider + text` so switching provider invalidates the cache for the
 *  same annotation. */
export function hashText(text: string, provider: string): string {
  return crypto
    .createHash("sha256")
    .update(`${provider}|${text}`)
    .digest("hex")
    .slice(0, 12);
}

/** Canonical per-clip filename inside the cache directory. */
export function clipFilename(
  stepIndex: number,
  text: string,
  provider: string
): string {
  return `step-${String(stepIndex).padStart(2, "0")}-${hashText(text, provider)}.mp3`;
}

// ---------------------------------------------------------------------------
// Audio helpers (ffmpeg / ffprobe)
// ---------------------------------------------------------------------------

/** Probe an audio file's duration in seconds. Returns 0 on failure. */
export function probeAudioDuration(filePath: string): number {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf-8", timeout: 10_000 }
    );
    const sec = Number.parseFloat(out.trim());
    return Number.isFinite(sec) ? sec : 0;
  } catch {
    return 0;
  }
}

async function convertToMp3(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputPath,
  ]);
}

// ---------------------------------------------------------------------------
// Per-provider synthesis
// ---------------------------------------------------------------------------

async function generatePiper(text: string, outPath: string): Promise<void> {
  const model = piperModelPath();
  if (!model) throw new Error("Piper voice model not found");

  const tmpWav = `${outPath}.wav`;
  await new Promise<void>((resolve, reject) => {
    const proc = execFile(
      "piper",
      ["--model", model, "--output_file", tmpWav],
      { timeout: 60_000 },
      (err) => (err ? reject(err) : resolve())
    );
    proc.stdin?.write(text);
    proc.stdin?.end();
  });

  await convertToMp3(tmpWav, outPath);
  fs.unlinkSync(tmpWav);
}

async function generateGoogle(
  text: string,
  outPath: string,
  voice: string
): Promise<void> {
  const token = execFileSync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    { encoding: "utf-8", timeout: 10_000 }
  ).trim();

  const voiceName = voice || "en-US-Neural2-F";
  const languageCode = voiceName.split("-").slice(0, 2).join("-");

  const resp = await fetch(
    "https://texttospeech.googleapis.com/v1/text:synthesize",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, pitch: 0 },
      }),
    }
  );

  if (!resp.ok) {
    throw new Error(
      `Google TTS request failed: ${resp.status} ${await resp.text()}`
    );
  }

  const data = (await resp.json()) as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error("Google TTS response missing audioContent");
  }
  fs.writeFileSync(outPath, Buffer.from(data.audioContent, "base64"));
}

async function generateOpenAi(
  text: string,
  outPath: string,
  voice: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const voiceName = voice || "alloy";
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: voiceName,
      input: text,
      format: "mp3",
    }),
  });

  if (!resp.ok) {
    throw new Error(
      `OpenAI TTS request failed: ${resp.status} ${await resp.text()}`
    );
  }

  fs.writeFileSync(outPath, Buffer.from(await resp.arrayBuffer()));
}

async function generateSay(
  text: string,
  outPath: string,
  voice: string
): Promise<void> {
  const voiceName = voice || "Samantha";
  const tmpAiff = `${outPath}.aiff`;
  await execFileAsync("say", ["-v", voiceName, "-o", tmpAiff, text], {
    timeout: 60_000,
  });
  await convertToMp3(tmpAiff, outPath);
  fs.unlinkSync(tmpAiff);
}

async function synthesize(
  provider: TtsProviderName,
  text: string,
  outPath: string,
  voice: string
): Promise<void> {
  switch (provider) {
    case "piper":
      return generatePiper(text, outPath);
    case "google":
      return generateGoogle(text, outPath, voice);
    case "openai":
      return generateOpenAi(text, outPath, voice);
    case "say":
      return generateSay(text, outPath, voice);
  }
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

/**
 * Generate (or reuse cached) audio clips for the given per-step texts.
 *
 * Cache model: a content hash keyed by `(provider, text)`. Cache hits skip
 * synthesis entirely — the caller gets back the existing file.
 *
 * Returns the provider that actually ran (null if none was available) and
 * the list of generated/cached clips.
 */
export async function generateVoiceOver(
  options: GenerateOptions
): Promise<GenerateResult> {
  const { texts, cacheDir, voice = "" } = options;
  const provider = options.provider ?? detectProvider();
  if (!provider) {
    throw new Error(
      `No TTS provider available. Install one of: piper (local), gcloud (Google Cloud TTS), OPENAI_API_KEY (OpenAI), or run on macOS (say). Detection order: ${PROVIDER_ORDER.join(" → ")}.`
    );
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  console.log(`[tts] Using provider: ${provider}`);

  const clips: TtsClip[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text || text.trim().length === 0) continue;

    const filename = clipFilename(i, text, provider);
    const outPath = path.join(cacheDir, filename);

    if (!fs.existsSync(outPath)) {
      try {
        await synthesize(provider, text, outPath, voice);
      } catch (err) {
        console.warn(
          `[tts] Failed on step ${i + 1}: ${(err as Error).message}`
        );
        continue;
      }
    }

    const durationSec = probeAudioDuration(outPath);
    clips.push({ stepIndex: i, path: outPath, durationSec });
    console.log(
      `[tts]   step ${i + 1}: ${filename} (${durationSec.toFixed(2)}s)`
    );
  }

  return { provider, clips };
}
