import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/mobile-push-url.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(result.outputFiles[0].text).toString("base64");
const { isAllowedPushEndpoint } = await import(`data:text/javascript;base64,${code}`);

test("accepts known browser push service origins", () => {
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/token"), true);
  assert.equal(isAllowedPushEndpoint("https://web.push.apple.com/endpoint/token"), true);
  assert.equal(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/token"), true);
});

test("rejects private, unknown, and non-default-port push destinations", () => {
  assert.equal(isAllowedPushEndpoint("https://127.0.0.1/admin"), false);
  assert.equal(isAllowedPushEndpoint("https://[::1]/admin"), false);
  assert.equal(isAllowedPushEndpoint("https://attacker.example/collect"), false);
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/send"), false);
  assert.equal(isAllowedPushEndpoint("http://fcm.googleapis.com/send"), false);
});
