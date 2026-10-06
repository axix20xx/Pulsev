import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandArguments = process.argv.slice(2).filter((argument) => argument !== "--");
const archiveArgument = commandArguments[0];
if (!archiveArgument) {
  throw new Error(
    "Usage: pnpm run check:hostinger-release -- <path-to-hostinger-zip>",
  );
}
if (commandArguments.length > 1) {
  throw new Error("Pass exactly one Hostinger ZIP path to the release checker.");
}

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const archivePath = path.resolve(workspaceRoot, archiveArgument);

function run(
  command: string,
  args: string[],
  cwd?: string,
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout;
}

async function checkStaging(releaseRoot: string, releaseId: string): Promise<void> {
  const rawUrl = process.env.HOSTINGER_STAGING_URL;
  if (!rawUrl) {
    console.log("Package validation passed; staging HTTP checks were skipped.");
    return;
  }
  if (process.env.HOSTINGER_STAGING_CONFIRMED !== "1") {
    throw new Error(
      "Set HOSTINGER_STAGING_CONFIRMED=1 only after confirming the URL is an isolated staging app.",
    );
  }

  const stagingUrl = new URL(rawUrl);
  if (
    stagingUrl.protocol !== "https:" ||
    stagingUrl.username ||
    stagingUrl.password ||
    stagingUrl.search ||
    stagingUrl.hash ||
    stagingUrl.pathname !== "/"
  ) {
    throw new Error("HOSTINGER_STAGING_URL must be a clean HTTPS origin, such as https://staging.example.com.");
  }

  async function get(pathname: string): Promise<string> {
    const response = await fetch(new URL(pathname, stagingUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Staging GET ${pathname} returned HTTP ${response.status}.`);
    }
    return body;
  }

  const deployedRelease = JSON.parse(await get("/release.json")) as {
    releaseId?: unknown;
  };
  if (deployedRelease.releaseId !== releaseId) {
    throw new Error(
      `Staging release mismatch: expected ${releaseId}, received ${String(deployedRelease.releaseId)}.`,
    );
  }

  await get("/api/healthz");
  const readiness = JSON.parse(await get("/api/readyz")) as {
    status?: unknown;
    backgroundWorkersPaused?: unknown;
  };
  if (readiness.status !== "ready") {
    throw new Error(`Staging API is not ready: ${String(readiness.status)}.`);
  }
  if (readiness.backgroundWorkersPaused !== true) {
    throw new Error("Staging background workers are not paused.");
  }

  const routes = [
    { route: "/", page: "web/index.html" },
    { route: "/panel/", page: "web/panel/index.html" },
    { route: "/mobile/", page: "web/mobile/index.html" },
    { route: "/showcase/", page: "web/showcase/index.html" },
    { route: "/sub/staging-release-check", page: "web/sub-app/index.html" },
  ] as const;

  for (const { route, page } of routes) {
    const expectedHtml = await readFile(path.join(releaseRoot, page), "utf8");
    const liveHtml = await get(route);
    const assetUrls = [
      ...expectedHtml.matchAll(/(?:src|href)=["'](\/[^"']+\.(?:css|js))["']/g),
    ].map((match) => match[1]);

    if (!assetUrls.length || assetUrls.some((assetUrl) => !liveHtml.includes(assetUrl))) {
      throw new Error(`Staging route ${route} does not serve the expected release assets.`);
    }
    for (const assetUrl of assetUrls) await get(assetUrl);
  }

  console.log(`Staging checks passed for ${stagingUrl.host} at release ${releaseId}.`);
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pulse-hostinger-release-"));
try {
  const checksumContents = await readFile(`${archivePath}.sha256`, "utf8");
  const checksumMatch = checksumContents.trim().match(/^([a-f0-9]{64})\s+(.+)$/i);
  if (!checksumMatch || path.basename(checksumMatch[2]) !== path.basename(archivePath)) {
    throw new Error("Hostinger release checksum file is missing or malformed.");
  }
  const archiveHash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) archiveHash.update(chunk);
  if (archiveHash.digest("hex") !== checksumMatch[1].toLowerCase()) {
    throw new Error("Hostinger release ZIP does not match its SHA-256 checksum.");
  }

  run("unzip", ["-tq", archivePath]);
  const entries = run("unzip", ["-Z1", archivePath])
    .split(/\r?\n/)
    .filter(Boolean);
  const entrySet = new Set(entries);
  const requiredEntries = [
    "app.js",
    "launcher.mjs",
    "release.json",
    "web/release.json",
    "web/index.html",
    "web/panel/index.html",
    "web/mobile/index.html",
    "web/showcase/index.html",
    "web/sub-app/index.html",
    "web/panel-sub-assets/index.html",
    "api/index.mjs",
    "api/hostinger-entry.mjs",
    "api/lib/migrate-legacy-sql.mjs",
    "supabase-import.sql",
  ];
  const missingEntries = requiredEntries.filter((entry) => !entrySet.has(entry));
  if (missingEntries.length) {
    throw new Error(`Hostinger ZIP is missing: ${missingEntries.join(", ")}.`);
  }
  for (const entry of entries) {
    const name = path.posix.basename(entry);
    if (/^\.env(?:\..+)?$/.test(name) && name !== ".env.example") {
      throw new Error(`Refusing a package that includes a runtime env file: ${entry}`);
    }
  }

  run("unzip", ["-q", archivePath, "-d", temporaryRoot]);
  const release = JSON.parse(
    await readFile(path.join(temporaryRoot, "release.json"), "utf8"),
  ) as { releaseId?: unknown };
  if (typeof release.releaseId !== "string" || !release.releaseId) {
    throw new Error("Hostinger ZIP has no valid release ID.");
  }

  run("node", ["build.mjs"], temporaryRoot);
  console.log(`Hostinger ZIP package checks passed for release ${release.releaseId}.`);
  await checkStaging(temporaryRoot, release.releaseId);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
