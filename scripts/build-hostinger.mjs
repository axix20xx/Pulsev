import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportRoot = path.join(workspaceRoot, "hostinger-export");
const webRoot = path.join(exportRoot, "web");
const outputZip = path.join(
  workspaceRoot,
  "exports",
  "pulse-hostinger-fast-full-migration-2026-10-06.zip",
);
const frontendDist = path.join(workspaceRoot, "artifacts/sales-manager/dist/public");
const showcaseDist = path.join(workspaceRoot, "artifacts/gift-card-showcase/dist/public");
const apiDist = path.join(workspaceRoot, "artifacts/api-server/dist");

function run(command, args, { cwd = workspaceRoot, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function replaceDirectory(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function createGzipSidecars(directory) {
  const compressible = new Set([".css", ".html", ".js", ".json", ".svg", ".webmanifest"]);
  let generated = 0;
  for (const filePath of await collectFiles(directory)) {
    if (filePath.endsWith(".gz") || !compressible.has(path.extname(filePath).toLowerCase())) {
      continue;
    }
    const source = await readFile(filePath);
    const compressed = gzipSync(source, { level: 9 });
    if (compressed.byteLength >= source.byteLength) continue;
    await writeFile(`${filePath}.gz`, compressed);
    generated += 1;
  }
  return generated;
}

async function verifyNoRuntimeSecrets() {
  for (const filePath of await collectFiles(exportRoot)) {
    const name = path.basename(filePath);
    if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
      throw new Error(`Refusing to package runtime secret file: ${path.relative(exportRoot, filePath)}`);
    }
  }
}

function buildFrontend(packageName, basePath, port) {
  run(
    "pnpm",
    ["--filter", packageName, "run", "build"],
    { env: { BASE_PATH: basePath, PORT: String(port), NODE_ENV: "production" } },
  );
}

console.log("Building the API bundle...");
run("pnpm", ["--filter", "@workspace/api-server", "run", "build"]);
await cp(apiDist, path.join(exportRoot, "api"), { recursive: true });

const salesBuilds = [
  { basePath: "/", destination: webRoot, port: 3000 },
  { basePath: "/panel/", destination: path.join(webRoot, "panel"), port: 3001 },
  { basePath: "/mobile/", destination: path.join(webRoot, "mobile"), port: 3002 },
  {
    basePath: "/panel-sub-assets/",
    destination: path.join(webRoot, "panel-sub-assets"),
    port: 3003,
  },
];

for (const build of salesBuilds) {
  console.log(`Building the sales app for ${build.basePath}...`);
  buildFrontend("@workspace/sales-manager", build.basePath, build.port);
  await replaceDirectory(frontendDist, build.destination);
  if (build.basePath === "/panel-sub-assets/") {
    const subscriptionRoot = path.join(webRoot, "sub-app");
    await rm(subscriptionRoot, { recursive: true, force: true });
    await mkdir(subscriptionRoot, { recursive: true });
    await cp(
      path.join(build.destination, "index.html"),
      path.join(subscriptionRoot, "index.html"),
    );
  }
}

console.log("Building the showcase for /showcase/...");
buildFrontend("@workspace/gift-card-showcase", "/showcase/", 3004);
await replaceDirectory(showcaseDist, path.join(webRoot, "showcase"));

await verifyNoRuntimeSecrets();
await stat(path.join(exportRoot, "legacy/legacy.sql"));

const mobileManifestPath = path.join(webRoot, "mobile/mobile/manifest.webmanifest");
const mobileManifest = JSON.parse(await readFile(mobileManifestPath, "utf8"));
mobileManifest.id = "/mobile";
mobileManifest.start_url = "/mobile";
mobileManifest.scope = "/mobile/";
await writeFile(
  mobileManifestPath,
  `${JSON.stringify(mobileManifest, null, 2)}\n`,
  "utf8",
);

console.log("Generating precompressed static assets...");
const compressedFiles = await createGzipSidecars(webRoot);

console.log("Validating the Hostinger package...");
run("node", ["build.mjs"], { cwd: exportRoot });

await mkdir(path.dirname(outputZip), { recursive: true });
await rm(outputZip, { force: true });
console.log("Creating the full migration ZIP...");
run(
  "zip",
  [
    "-q",
    "-r",
    "-9",
    outputZip,
    ".",
    "-x",
    "node_modules/*",
    "*/node_modules/*",
    ".git/*",
    "*/.git/*",
    "*.log",
    "*/.DS_Store",
  ],
  { cwd: exportRoot },
);

const zipStat = await stat(outputZip);
console.log(
  `Ready: ${path.relative(workspaceRoot, outputZip)} (${(zipStat.size / 1024 / 1024).toFixed(1)} MB; ${compressedFiles} gzip sidecars).`,
);
