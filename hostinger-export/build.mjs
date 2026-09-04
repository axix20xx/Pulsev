import { access } from "node:fs/promises";

const requiredFiles = [
  "app.js",
  "launcher.mjs",
  "web/index.html",
  "api/index.mjs",
  "api/lib/migrate-legacy-sql.mjs",
];

for (const file of requiredFiles) {
  await access(file);
}

console.log(`Pulse production bundle verified (${requiredFiles.length} files).`);