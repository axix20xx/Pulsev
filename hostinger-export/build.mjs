import { access, readFile, writeFile } from "node:fs/promises";

const requiredFiles = [
  "app.js",
  "launcher.mjs",
  "installer.html",
  "web/index.html",
  "web/panel/index.html",
  "web/mobile/index.html",
  "web/showcase/index.html",
  "web/sub-app/index.html",
  "api/index.mjs",
  "api/hostinger-entry.mjs",
  "api/lib/migrate-legacy-sql.mjs",
];

for (const file of requiredFiles) {
  await access(file);
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

console.log(`Pulse production bundle verified (${requiredFiles.length} files, including panel and showcase).`);