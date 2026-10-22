import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadDownloadHelpers() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/public-download.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

test("WireGuard filenames always keep the app-specific .conf suffix", async () => {
  const { safeDownloadFilename } = await loadDownloadHelpers();
  assert.equal(
    safeDownloadFilename('attachment; filename="client.txt"', "Pulse-wg", ".conf"),
    "client.conf",
  );
  assert.equal(
    safeDownloadFilename("attachment; filename*=UTF-8''%D9%85%D9%86%D8%B7%D9%82%D9%87.txt", "Pulse-wg", ".conf"),
    "منطقه.conf",
  );
});

test("download filenames discard paths and control characters", async () => {
  const { safeDownloadFilename } = await loadDownloadHelpers();
  assert.equal(
    safeDownloadFilename('attachment; filename="../../client.txt"', "Pulse-awg", ".conf"),
    "client.conf",
  );
});

test("content disposition includes a safe ASCII name and encoded UTF-8 name", async () => {
  const { attachmentDisposition, publicConfigContentType, safeDownloadFilename } = await loadDownloadHelpers();
  const header = attachmentDisposition("Pulse-اشتراک.mobileconfig");
  assert.match(header, /^attachment; filename="Pulse-.*\.mobileconfig"; filename\*=UTF-8''/);
  assert.equal(publicConfigContentType(".conf"), "application/octet-stream");
  assert.equal(publicConfigContentType(".ovpn"), "application/x-openvpn-profile");
  assert.equal(publicConfigContentType(".zip"), "application/zip");
  assert.equal(publicConfigContentType(".mobileconfig"), "application/x-apple-aspen-config");
  assert.equal(safeDownloadFilename('attachment; filename="bundle.txt"', "Pulse-wg", ".zip"), "bundle.zip");
  assert.equal(safeDownloadFilename('attachment; filename="profile.txt"', "Pulse-vpn", ".ovpn"), "profile.ovpn");
});
