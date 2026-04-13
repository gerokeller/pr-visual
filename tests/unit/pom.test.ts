import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  invokePom,
  listPomMethods,
  loadPomModules,
} from "../../scripts/pr-visual/pom.js";

const FIXTURE_ROOT = path.resolve(__dirname, "..");
const DASHBOARD = "fixtures/poms/dashboard.js";
const BROKEN = "fixtures/poms/broken.js";

describe("loadPomModules", () => {
  it("returns an empty map when no poms are configured", () => {
    expect(loadPomModules(undefined, FIXTURE_ROOT)).toEqual({});
    expect(loadPomModules({}, FIXTURE_ROOT)).toEqual({});
  });

  it("loads a module and exposes its named function exports", () => {
    const loaded = loadPomModules({ dashboard: DASHBOARD }, FIXTURE_ROOT);
    expect(Object.keys(loaded)).toEqual(["dashboard"]);
    expect(typeof loaded.dashboard!.login).toBe("function");
    expect(typeof loaded.dashboard!.openHome).toBe("function");
  });

  it("throws when the module path does not resolve", () => {
    expect(() =>
      loadPomModules({ missing: "fixtures/poms/nope.js" }, FIXTURE_ROOT)
    ).toThrowError(/Failed to load POM module "missing"/);
  });

  it("throws when the module exports no callables", () => {
    expect(() => loadPomModules({ empty: BROKEN }, FIXTURE_ROOT)).toThrowError(
      /does not export any callable functions/
    );
  });
});

describe("listPomMethods", () => {
  const loaded = loadPomModules({ dashboard: DASHBOARD }, FIXTURE_ROOT);

  it("returns the method names for a known page", () => {
    const methods = listPomMethods(loaded, "dashboard");
    expect(methods).toContain("login");
    expect(methods).toContain("openHome");
  });

  it("returns null for an unknown page", () => {
    expect(listPomMethods(loaded, "ghost")).toBeNull();
  });
});

describe("invokePom", () => {
  const loaded = loadPomModules({ dashboard: DASHBOARD }, FIXTURE_ROOT);
  // Minimal Page stub — records calls instead of driving a real browser.
  function makePageStub() {
    const calls: { method: string; args: unknown[] }[] = [];
    return {
      calls,
      page: {
        evaluate: async (...args: unknown[]) => {
          calls.push({ method: "evaluate", args });
        },
        goto: async (...args: unknown[]) => {
          calls.push({ method: "goto", args });
        },
        context: () => ({ baseUrl: "http://localhost:3999/" }),
      } as unknown as import("playwright").Page,
    };
  }

  it("calls the registered method with page + user args", async () => {
    const { page, calls } = makePageStub();
    await invokePom(loaded, page, {
      page: "dashboard",
      method: "login",
      args: ["alice"],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("evaluate");
    // The fixture passes the user arg through page.evaluate as the second arg.
    expect(calls[0]!.args[1]).toBe("alice");
  });

  it("defaults to no args when step.args is omitted", async () => {
    const { page, calls } = makePageStub();
    await invokePom(loaded, page, { page: "dashboard", method: "openHome" });
    expect(calls[0]!.method).toBe("goto");
  });

  it("throws on unknown page", async () => {
    const { page } = makePageStub();
    await expect(
      invokePom(loaded, page, { page: "ghost", method: "login" })
    ).rejects.toThrow(/Unknown POM page "ghost"\. Known pages: dashboard\./);
  });

  it("throws on unknown method with available-methods list", async () => {
    const { page } = makePageStub();
    await expect(
      invokePom(loaded, page, { page: "dashboard", method: "ghost" })
    ).rejects.toThrow(
      /Unknown POM method "dashboard\.ghost"\. Available methods: openHome, login\./
    );
  });

  it("throws when step is missing required fields", async () => {
    const { page } = makePageStub();
    await expect(invokePom(loaded, page, { method: "login" })).rejects.toThrow(
      /missing `page`/
    );
    await expect(
      invokePom(loaded, page, { page: "dashboard" })
    ).rejects.toThrow(/missing `method`/);
  });
});
