import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/pasarguard-instance.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { samePasarGuardInstance } = await import(`data:text/javascript;base64,${code}`);

test("PasarGuard API bases match despite host casing and trailing slashes", () => {
  assert.equal(
    samePasarGuardInstance("https://PANEL.example.test/api/", "https://panel.example.test/api"),
    true,
  );
});

test("different PasarGuard hosts, protocols, or base paths do not share user IDs", () => {
  assert.equal(samePasarGuardInstance("https://one.example.test", "https://two.example.test"), false);
  assert.equal(samePasarGuardInstance("http://panel.example.test", "https://panel.example.test"), false);
  assert.equal(samePasarGuardInstance("https://panel.example.test/api", "https://panel.example.test/other"), false);
  assert.equal(samePasarGuardInstance("not-a-url", "https://panel.example.test"), false);
});
