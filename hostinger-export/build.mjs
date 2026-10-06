import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const requiredFiles = [
  "app.js",
  "launcher.mjs",
  "installer.html",
  "release.json",
  "web/index.html",
  "web/release.json",
  "web/panel/index.html",
  "web/mobile/index.html",
  "web/showcase/index.html",
  "web/sub-app/index.html",
  "web/panel-sub-assets/index.html",
  "api/index.mjs",
  "api/hostinger-entry.mjs",
  "api/lib/migrate-legacy-sql.mjs",
];

for (const file of requiredFiles) {
  await access(file);
}

const packageRelease = JSON.parse(await readFile("release.json", "utf8"));
const webRelease = JSON.parse(await readFile("web/release.json", "utf8"));
if (
  typeof packageRelease.releaseId !== "string" ||
  !packageRelease.releaseId ||
  packageRelease.releaseId !== webRelease.releaseId
) {
  throw new Error("Hostinger release metadata is missing or inconsistent.");
}

const webIndex = await readFile("web/index.html", "utf8");
if (/["']\/sales-manager\//.test(webIndex)) {
  throw new Error(
    "Hostinger web bundle must be built for the domain root (BASE_PATH=/), not /sales-manager.",
  );
}

const showcaseIndex = await readFile("web/showcase/index.html", "utf8");
if (!/["']\/showcase\/assets\//.test(showcaseIndex)) {
  throw new Error(
    "Hostinger showcase bundle must be built for /showcase/, not the Replit artifact path.",
  );
}

const panelIndex = await readFile("web/panel/index.html", "utf8");
if (!/["']\/panel\/assets\//.test(panelIndex)) {
  throw new Error(
    "Hostinger panel bundle must be built for /panel/, not the domain root.",
  );
}

const mobileIndex = await readFile("web/mobile/index.html", "utf8");
if (!/["']\/mobile\/assets\//.test(mobileIndex)) {
  throw new Error(
    "Hostinger mobile bundle must be built for /mobile/, not /panel/ or the domain root.",
  );
}

const mobileManifestPath = "web/mobile/mobile/manifest.webmanifest";
const mobileManifest = JSON.parse(await readFile(mobileManifestPath, "utf8"));
mobileManifest.id = "/mobile";
mobileManifest.start_url = "/mobile";
mobileManifest.scope = "/mobile/";
await writeFile(`${mobileManifestPath}`, `${JSON.stringify(mobileManifest, null, 2)}\n`, "utf8");

const subscriptionIndex = await readFile("web/sub-app/index.html", "utf8");
if (!/["']\/panel-sub-assets\//.test(subscriptionIndex)) {
  throw new Error(
    "Hostinger subscription bundle must use its isolated asset path.",
  );
}

const panelSubscriptionIndex = await readFile("web/panel-sub-assets/index.html", "utf8");
if (!/["']\/panel-sub-assets\/assets\//.test(panelSubscriptionIndex)) {
  throw new Error("Hostinger subscription asset page must use /panel-sub-assets/.");
}

const launcherSource = await readFile("launcher.mjs", "utf8");
for (const routeMarker of [
  'pathname === "/panel"',
  'pathname === "/mobile"',
  'pathname === "/sub"',
  'pathname.startsWith("/panel-sub-assets/")',
  'PULSE_WORKERS_PAUSED: process.env.PULSE_WORKERS_PAUSED || "0"',
]) {
  if (!launcherSource.includes(routeMarker)) {
    throw new Error(`Hostinger launcher is missing required release behavior: ${routeMarker}`);
  }
}

const apiBundle = await readFile("api/index.mjs", "utf8");
for (const workerMarker of ["PULSE_WORKERS_PAUSED", "backgroundWorkersPaused"]) {
  if (!apiBundle.includes(workerMarker)) {
    throw new Error(`Hostinger API bundle is missing worker pause support: ${workerMarker}`);
  }
}

const assetPages = [
  "web/index.html",
  "web/panel/index.html",
  "web/mobile/index.html",
  "web/showcase/index.html",
  "web/sub-app/index.html",
  "web/panel-sub-assets/index.html",
];
for (const page of assetPages) {
  const html = await readFile(page, "utf8");
  const references = [...html.matchAll(/(?:src|href)=["'](\/[^"']+\.(?:css|js))["']/g)];
  if (!references.length) throw new Error(`No JavaScript or CSS assets were found in ${page}.`);
  for (const [, assetUrl] of references) {
    const assetPath = path.resolve("web", assetUrl.slice(1));
    if (!assetPath.startsWith(`${path.resolve("web")}${path.sep}`)) {
      throw new Error(`Asset path escapes the web bundle: ${assetUrl}`);
    }
    await access(assetPath);
    await access(`${assetPath}.gz`);
  }
}

console.log(`Pulse production bundle verified (${requiredFiles.length} files, including panel and showcase).`);