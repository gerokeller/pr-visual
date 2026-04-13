import { createRequire } from "node:module";
import * as path from "node:path";
import type { Page } from "playwright";

/** Signature of a single POM function. Must accept the Playwright `Page` as
 *  the first arg and return either void or a Promise. */
export type PomFunction = (
  page: Page,
  ...args: unknown[]
) => void | Promise<void>;

/** A single POM module after load. Keys are method names; values are the
 *  exported callables. */
export type LoadedPom = Record<string, PomFunction>;

/** All loaded POM modules, keyed by the name registered in
 *  `ProjectConfig.poms`. */
export type LoadedPoms = Record<string, LoadedPom>;

const nodeRequire = createRequire(__filename);

function resolveModulePath(modulePath: string, projectRoot: string): string {
  return path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(projectRoot, modulePath);
}

/** Eagerly load every configured POM module and extract its callable
 *  exports. Throws with a clear message if a module fails to load or
 *  exports nothing callable.
 *
 *  Loading eagerly (at validation time) lets us surface unknown `page` /
 *  `method` references as pre-capture errors instead of runtime crashes. */
export function loadPomModules(
  poms: Record<string, string> | undefined,
  projectRoot: string
): LoadedPoms {
  const out: LoadedPoms = {};
  if (!poms) return out;

  for (const [name, modulePath] of Object.entries(poms)) {
    const abs = resolveModulePath(modulePath, projectRoot);
    let mod: unknown;
    try {
      mod = nodeRequire(abs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to load POM module "${name}" from ${abs}: ${msg}`
      );
    }

    if (!mod || (typeof mod !== "object" && typeof mod !== "function")) {
      throw new Error(
        `POM module "${name}" at ${abs} must export named functions; got ${typeof mod}.`
      );
    }

    // ESM default exports land under `.default`; flatten them in.
    const source = mod as Record<string, unknown>;
    const maybeDefault =
      source.default && typeof source.default === "object"
        ? (source.default as Record<string, unknown>)
        : {};

    const methods: LoadedPom = {};
    for (const [key, value] of Object.entries({ ...source, ...maybeDefault })) {
      if (key === "default") continue;
      if (typeof value === "function") {
        methods[key] = value as PomFunction;
      }
    }

    if (Object.keys(methods).length === 0) {
      throw new Error(
        `POM module "${name}" at ${abs} does not export any callable functions.`
      );
    }

    out[name] = methods;
  }

  return out;
}

/** List the available POM method names for the given `page`, or null if
 *  the `page` is not registered. Used by the validator to build friendly
 *  error messages. */
export function listPomMethods(
  loaded: LoadedPoms,
  page: string
): string[] | null {
  const mod = loaded[page];
  return mod ? Object.keys(mod) : null;
}

/** Execute a `pom` step. Throws if `page` or `method` is unknown. */
export async function invokePom(
  loaded: LoadedPoms,
  page: Page,
  step: { page?: string; method?: string; args?: unknown[] }
): Promise<void> {
  if (!step.page) {
    throw new Error("pom step is missing `page`.");
  }
  if (!step.method) {
    throw new Error("pom step is missing `method`.");
  }
  const mod = loaded[step.page];
  if (!mod) {
    const known = Object.keys(loaded);
    const knownStr = known.length ? known.join(", ") : "<none configured>";
    throw new Error(
      `Unknown POM page "${step.page}". Known pages: ${knownStr}.`
    );
  }
  const fn = mod[step.method];
  if (typeof fn !== "function") {
    const knownMethods = Object.keys(mod).join(", ");
    throw new Error(
      `Unknown POM method "${step.page}.${step.method}". Available methods: ${knownMethods}.`
    );
  }
  const args = step.args ?? [];
  await fn(page, ...args);
}
