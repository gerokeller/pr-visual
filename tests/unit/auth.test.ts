import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AUTH_DIR_ENV_VAR,
  DEFAULT_AUTH_DIR,
  resolveAuth,
  resolveProfilePath,
  validateStorageStates,
} from "../../scripts/pr-visual/auth.js";

const PROJECT_ROOT = "/tmp/pr-visual-auth-test-project";

describe("resolveAuth", () => {
  it("falls back to .pr-visual/auth when nothing is set", () => {
    const r = resolveAuth(undefined, PROJECT_ROOT, {});
    expect(r.storageStateDir).toBe(
      path.resolve(PROJECT_ROOT, DEFAULT_AUTH_DIR)
    );
    expect(r.profilePaths).toEqual({});
    expect(DEFAULT_AUTH_DIR).toBe(".pr-visual/auth");
  });

  it("respects an explicit storageStateDir", () => {
    const r = resolveAuth(
      { storageStateDir: "auth/state", profiles: { admin: "admin.json" } },
      PROJECT_ROOT,
      {}
    );
    expect(r.storageStateDir).toBe(path.resolve(PROJECT_ROOT, "auth/state"));
    expect(r.profilePaths.admin).toBe(
      path.resolve(PROJECT_ROOT, "auth/state/admin.json")
    );
  });

  it("treats profile paths as relative to storageStateDir", () => {
    const r = resolveAuth(
      { profiles: { owner: "owner.json", viewer: "subdir/v.json" } },
      PROJECT_ROOT,
      {}
    );
    expect(r.profilePaths.owner).toBe(
      path.resolve(PROJECT_ROOT, DEFAULT_AUTH_DIR, "owner.json")
    );
    expect(r.profilePaths.viewer).toBe(
      path.resolve(PROJECT_ROOT, DEFAULT_AUTH_DIR, "subdir/v.json")
    );
  });

  it("preserves absolute profile paths", () => {
    const r = resolveAuth(
      { profiles: { absolute: "/var/auth/state.json" } },
      PROJECT_ROOT,
      {}
    );
    expect(r.profilePaths.absolute).toBe("/var/auth/state.json");
  });

  it("PR_VISUAL_AUTH_DIR overrides storageStateDir", () => {
    const r = resolveAuth(
      { storageStateDir: "config/auth", profiles: { admin: "admin.json" } },
      PROJECT_ROOT,
      { [AUTH_DIR_ENV_VAR]: "/elsewhere" }
    );
    expect(r.storageStateDir).toBe("/elsewhere");
    expect(r.profilePaths.admin).toBe("/elsewhere/admin.json");
  });

  it("treats empty env override as unset", () => {
    const r = resolveAuth({ profiles: { admin: "admin.json" } }, PROJECT_ROOT, {
      [AUTH_DIR_ENV_VAR]: "",
    });
    expect(r.storageStateDir).toBe(
      path.resolve(PROJECT_ROOT, DEFAULT_AUTH_DIR)
    );
  });
});

describe("resolveProfilePath", () => {
  const resolved = resolveAuth(
    { profiles: { admin: "admin.json", viewer: "viewer.json" } },
    PROJECT_ROOT,
    {}
  );

  it("returns the absolute path for a known profile", () => {
    expect(resolveProfilePath("admin", resolved)).toContain("admin.json");
  });

  it("throws on an unknown profile name with the known list", () => {
    expect(() => resolveProfilePath("ghost", resolved)).toThrowError(
      /Unknown auth profile "ghost"\. Known profiles: admin, viewer\./
    );
  });

  it("reports <none configured> when no profiles are set", () => {
    const empty = resolveAuth(undefined, PROJECT_ROOT, {});
    expect(() => resolveProfilePath("anything", empty)).toThrowError(
      /Known profiles: <none configured>/
    );
  });
});

describe("validateStorageStates", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("accepts valid JSON storage state files", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-auth-"));
    const file = path.join(tmp, "admin.json");
    fs.writeFileSync(file, '{"cookies":[]}');
    expect(() =>
      validateStorageStates({
        storageStateDir: tmp,
        profilePaths: { admin: file },
      })
    ).not.toThrow();
  });

  it("throws when a configured profile file is missing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-auth-"));
    expect(() =>
      validateStorageStates({
        storageStateDir: tmp,
        profilePaths: { admin: path.join(tmp, "missing.json") },
      })
    ).toThrowError(/storage state not found.*Did the tokenGenerator/);
  });

  it("throws when a profile file is not valid JSON", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-auth-"));
    const file = path.join(tmp, "broken.json");
    fs.writeFileSync(file, "not json");
    expect(() =>
      validateStorageStates({
        storageStateDir: tmp,
        profilePaths: { broken: file },
      })
    ).toThrowError(/not valid JSON/);
  });
});
