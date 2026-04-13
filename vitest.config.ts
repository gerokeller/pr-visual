import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Optional peer deps for the Remotion compositing path. Listed as
    // `peerDependenciesMeta.optional: true` so they may not be installed.
    // Marking them external prevents vite/vitest from trying to resolve
    // them at module-graph time — the compositing module's runtime
    // try/catch handles the actual import failure.
    server: {
      deps: {
        external: [
          "remotion",
          "@remotion/bundler",
          "@remotion/renderer",
          "react",
          "react-dom",
        ],
      },
    },
  },
});
