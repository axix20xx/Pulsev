import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "app.js",
  "launcher.mjs",
  "installer.html",
  "web/index.html",
  "api/index.mjs",
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

console.log(`Pulse production bundle verified (${requiredFiles.length} files).`);