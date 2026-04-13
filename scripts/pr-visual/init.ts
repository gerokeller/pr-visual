import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Project detection — sniff the codebase to generate a tailored config
// ---------------------------------------------------------------------------

interface Detection {
  framework: string | null;
  devCommand: string;
  defaultPort: number;
  packageManager: "npm" | "yarn" | "pnpm" | "bun";
  hasDocker: boolean;
  dockerServices: string[];
  orm: string | null;
  healthEndpoint: string | null;
}

function detectPackageManager(root: string): Detection["packageManager"] {
  if (
    fs.existsSync(path.join(root, "bun.lockb")) ||
    fs.existsSync(path.join(root, "bun.lock"))
  )
    return "bun";
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function detectFramework(
  pkg: Record<string, unknown>
): { framework: string | null; devCommand: string; port: number } | null {
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  const scripts = pkg.scripts as Record<string, string> | undefined;

  if (deps.next)
    return {
      framework: "Next.js",
      devCommand: "next dev --port {{port}}",
      port: 3000,
    };
  if (deps.nuxt || deps.nuxt3)
    return {
      framework: "Nuxt",
      devCommand: "nuxt dev --port {{port}}",
      port: 3000,
    };
  if (deps["@remix-run/dev"])
    return { framework: "Remix", devCommand: "remix dev", port: 3000 };
  if (deps["@sveltejs/kit"])
    return {
      framework: "SvelteKit",
      devCommand: "vite dev --port {{port}}",
      port: 5173,
    };
  if (deps.vite)
    return {
      framework: "Vite",
      devCommand: "vite --port {{port}}",
      port: 5173,
    };
  if (deps["@angular/core"])
    return {
      framework: "Angular",
      devCommand: "ng serve --port {{port}}",
      port: 4200,
    };
  if (deps.gatsby)
    return {
      framework: "Gatsby",
      devCommand: "gatsby develop -p {{port}}",
      port: 8000,
    };
  if (deps.astro)
    return {
      framework: "Astro",
      devCommand: "astro dev --port {{port}}",
      port: 4321,
    };

  // Fallback: check if there's a "dev" script
  if (scripts?.dev)
    return { framework: null, devCommand: scripts.dev, port: 3000 };

  return null;
}

function detectOrm(root: string, pkg: Record<string, unknown>): string | null {
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  if (deps.prisma || fs.existsSync(path.join(root, "prisma/schema.prisma")))
    return "prisma";
  if (deps["drizzle-orm"] || deps["drizzle-kit"]) return "drizzle";
  if (deps.typeorm) return "typeorm";
  if (deps.knex) return "knex";
  return null;
}

function detectDocker(root: string): {
  hasDocker: boolean;
  services: string[];
} {
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];

  for (const name of composeFiles) {
    const filePath = path.join(root, name);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      // Rough service extraction from YAML
      const services: string[] = [];
      const serviceMatch = content.match(/services:\s*\n([\s\S]*?)(?:\n\S|$)/);
      if (serviceMatch) {
        const lines = serviceMatch[1]!.split("\n");
        for (const line of lines) {
          const m = line.match(/^\s{2}(\w[\w-]*):/);
          if (m) services.push(m[1]!);
        }
      }
      return { hasDocker: true, services };
    }
  }
  return { hasDocker: false, services: [] };
}

function detectHealthEndpoint(root: string): string | null {
  // Look for common health/API route files
  const candidates = [
    "src/app/api/health/route.ts", // Next.js App Router
    "src/pages/api/health.ts", // Next.js Pages Router
    "app/api/health/route.ts",
    "pages/api/health.ts",
    "src/routes/api/health/+server.ts", // SvelteKit
    "server/api/health.ts", // Nuxt
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(root, candidate))) {
      return "/api/health";
    }
  }
  return null;
}

function detect(root: string): Detection {
  const pkgPath = path.join(root, "package.json");
  const pkg = readJson(pkgPath) ?? {};
  const pm = detectPackageManager(root);
  const fw = detectFramework(pkg);
  const orm = detectOrm(root, pkg);
  const docker = detectDocker(root);
  const health = detectHealthEndpoint(root);

  return {
    framework: fw?.framework ?? null,
    devCommand: fw?.devCommand ?? "npm run dev",
    defaultPort: fw?.port ?? 3000,
    packageManager: pm,
    hasDocker: docker.hasDocker,
    dockerServices: docker.services,
    orm,
    healthEndpoint: health,
  };
}

// ---------------------------------------------------------------------------
// Config generation
// ---------------------------------------------------------------------------

function installCmd(pm: Detection["packageManager"]): string {
  switch (pm) {
    case "bun":
      return "bun install --frozen-lockfile";
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return "yarn install --frozen-lockfile";
    default:
      return "npm ci";
  }
}

function runCmd(pm: Detection["packageManager"], script: string): string {
  switch (pm) {
    case "bun":
      return `bun run ${script}`;
    case "pnpm":
      return `pnpm ${script}`;
    case "yarn":
      return `yarn ${script}`;
    default:
      return `npx ${script}`;
  }
}

function migrationCommand(
  orm: string,
  pm: Detection["packageManager"]
): string | null {
  switch (orm) {
    case "prisma":
      return `${runCmd(pm, "prisma migrate deploy")}`;
    case "drizzle":
      return `${runCmd(pm, "drizzle-kit push")}`;
    case "typeorm":
      return `${runCmd(pm, "typeorm migration:run")}`;
    case "knex":
      return `${runCmd(pm, "knex migrate:latest")}`;
    default:
      return null;
  }
}

function seedCommand(
  orm: string,
  pm: Detection["packageManager"]
): string | null {
  switch (orm) {
    case "prisma":
      return `${runCmd(pm, "prisma db seed")}`;
    default:
      return null;
  }
}

function generateConfigSource(d: Detection): string {
  const lines: string[] = [];

  lines.push(
    `import type { ProjectConfig } from "pr-visual/scripts/pr-visual/types.js";`
  );
  lines.push(``);
  if (d.framework) {
    lines.push(
      `// Detected: ${d.framework} + ${d.packageManager}${d.orm ? ` + ${d.orm}` : ""}${d.hasDocker ? " + Docker" : ""}`
    );
  }
  lines.push(`export default {`);
  lines.push(`  port: ${d.defaultPort},`);
  lines.push(``);
  lines.push(`  devServer: {`);
  lines.push(`    command: "${d.devCommand}",`);
  lines.push(`  },`);

  // Setup steps
  const setupSteps: string[] = [];

  if (d.hasDocker && d.dockerServices.length > 0) {
    const services = d.dockerServices.join(" ");
    setupSteps.push(
      `    // Docker services are automatically scoped to this run via COMPOSE_PROJECT_NAME={{runId}}\n` +
        `    { name: "Start services", command: "docker compose up -d ${services}" },`
    );
  }

  if (d.orm) {
    const migrate = migrationCommand(d.orm, d.packageManager);
    if (migrate)
      setupSteps.push(
        `    { name: "Migrate database", command: "${migrate}" },`
      );
    const seed = seedCommand(d.orm, d.packageManager);
    if (seed) setupSteps.push(`    { name: "Seed data", command: "${seed}" },`);
  }

  if (setupSteps.length > 0) {
    lines.push(``);
    lines.push(`  setup: [`);
    lines.push(...setupSteps);
    lines.push(`  ],`);
  }

  // Readiness
  if (d.healthEndpoint) {
    lines.push(``);
    lines.push(`  readiness: {`);
    lines.push(`    path: "${d.healthEndpoint}",`);
    lines.push(`    timeout: 60_000,`);
    lines.push(`  },`);
  }

  // Teardown
  if (d.hasDocker) {
    lines.push(``);
    lines.push(`  teardown: [`);
    lines.push(
      `    // COMPOSE_PROJECT_NAME is set automatically — only this run's containers are removed`
    );
    lines.push(
      `    { name: "Stop services", command: "docker compose down -v" },`
    );
    lines.push(`  ],`);
  }

  lines.push(``);
  lines.push(`  installCommand: "${installCmd(d.packageManager)}",`);
  lines.push(`} satisfies ProjectConfig;`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initConfig(projectRoot: string): Promise<void> {
  const configPath = path.join(projectRoot, ".pr-visual.config.ts");

  if (fs.existsSync(configPath)) {
    console.log(`  Config already exists: ${configPath}`);
    console.log("  Remove it first if you want to regenerate.");
    return;
  }

  console.log("pr-visual init: Detecting project setup...");
  const d = detect(projectRoot);

  console.log(`  Framework:       ${d.framework ?? "unknown"}`);
  console.log(`  Package manager: ${d.packageManager}`);
  console.log(
    `  Docker:          ${d.hasDocker ? `yes (${d.dockerServices.join(", ")})` : "no"}`
  );
  console.log(`  ORM:             ${d.orm ?? "none"}`);
  console.log(`  Health endpoint: ${d.healthEndpoint ?? "none detected"}`);
  console.log(`  Default port:    ${d.defaultPort}`);

  const source = generateConfigSource(d);
  fs.writeFileSync(configPath, source, "utf-8");

  console.log(`\n  Created: ${configPath}`);
  console.log(
    "  Review and adjust the config for your project, then commit it."
  );

  ensureGitignoreEntries(projectRoot, [".pr-visual/auth/"]);
}

/** Append the listed entries to `.gitignore` if not already present. Creates
 *  the file when missing. The auth dir is added by default because storage
 *  state files contain session tokens. */
export function ensureGitignoreEntries(
  projectRoot: string,
  entries: string[]
): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  let existing = "";
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, "utf-8");
  }
  const existingLines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const toAdd = entries.filter((e) => !existingLines.has(e.trim()));
  if (toAdd.length === 0) return;

  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  const block = `${prefix}\n# pr-visual\n${toAdd.join("\n")}\n`;
  fs.writeFileSync(gitignorePath, existing + block, "utf-8");
  console.log(
    `  Updated: ${gitignorePath} (added ${toAdd.length} entry/entries)`
  );
}
