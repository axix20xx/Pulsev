import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportRoot = path.join(workspaceRoot, "hostinger-export");
const webRoot = path.join(exportRoot, "web");
const generatedAt = new Date();
const releaseId = generatedAt.toISOString().replace(/[:.]/g, "-");
const releaseMetadata = {
  releaseId,
  generatedAt: generatedAt.toISOString(),
  schemaVersion: 1,
};
const outputZip = path.join(
  workspaceRoot,
  "exports",
  `pulse-hostinger-full-migration-${releaseId}.zip`,
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

async function brandPublicRootAsFlorist(destination) {
  const indexPath = path.join(destination, "index.html");
  let html = await readFile(indexPath, "utf8");
  const replacements = [
    [/<title>[\s\S]*?<\/title>/, "<title>گل‌آرا | گل‌فروشیِ باغ ایرانی</title>", "title"],
    [/<meta name="description" content="[^"]*"\s*\/>/, '<meta name="description" content="گل‌آرا؛ گل‌فروشیِ باغ ایرانی با چیدمان‌های دست‌ساز و گل‌های فصل." />', "description"],
    [/<meta name="theme-color" content="[^"]*"\s*\/>/, '<meta name="theme-color" content="#466b4e" />', "theme color"],
    [/<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/>/, '<meta name="apple-mobile-web-app-title" content="گل‌آرا" />', "home-screen title"],
    [/<meta property="og:title" content="[^"]*"\s*\/>/, '<meta property="og:title" content="گل‌آرا | گل‌فروشیِ باغ ایرانی" />', "Open Graph title"],
    [/<meta property="og:description" content="[^"]*"\s*\/>/, '<meta property="og:description" content="گل‌های فصل، با چیدمانی از دلِ باغ." />', "Open Graph description"],
    [/<meta name="twitter:title" content="[^"]*"\s*\/>/, '<meta name="twitter:title" content="گل‌آرا | گل‌فروشیِ باغ ایرانی" />', "Twitter title"],
    [/<meta name="twitter:description" content="[^"]*"\s*\/>/, '<meta name="twitter:description" content="گل‌های فصل، با چیدمانی از دلِ باغ." />', "Twitter description"],
  ];
  for (const [pattern, replacement, label] of replacements) {
    if (!pattern.test(html)) throw new Error(`Could not apply florist root ${label} metadata.`);
    html = html.replace(pattern, replacement);
  }
  await writeFile(indexPath, html, "utf8");

  const manifestPath = path.join(destination, "manifest.webmanifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  Object.assign(manifest, {
    name: "گل‌آرا | گل‌فروشی باغ ایرانی",
    short_name: "گل‌آرا",
    description: "گل‌های فصل، با چیدمانی از دلِ باغ.",
    start_url: "/",
    scope: "/",
    background_color: "#f6f1e5",
    theme_color: "#466b4e",
    icons: [
      { src: "/flower-shop-icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      { src: "/flower-shop.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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
  if (build.basePath === "/") {
    await brandPublicRootAsFlorist(build.destination);
  }
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

const releaseJson = `${JSON.stringify(releaseMetadata, null, 2)}\n`;
await writeFile(path.join(exportRoot, "release.json"), releaseJson, "utf8");
await writeFile(path.join(webRoot, "release.json"), releaseJson, "utf8");

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
const outputAlreadyExists = await stat(outputZip).then(
  () => true,
  (error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  },
);
if (outputAlreadyExists) {
  throw new Error(`Refusing to overwrite existing release archive: ${outputZip}`);
}
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

run("unzip", ["-tq", outputZip]);
const hash = createHash("sha256");
for await (const chunk of createReadStream(outputZip)) hash.update(chunk);
const checksum = hash.digest("hex");
await writeFile(
  `${outputZip}.sha256`,
  `${checksum}  ${path.basename(outputZip)}\n`,
  "utf8",
);
const zipStat = await stat(outputZip);
console.log(
  `Ready: ${path.relative(workspaceRoot, outputZip)} (${(zipStat.size / 1024 / 1024).toFixed(1)} MB; ${compressedFiles} gzip sidecars; SHA-256 ${checksum}).`,
);
