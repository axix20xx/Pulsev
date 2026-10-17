import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadLinks() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/wireguard-delivery-links.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

test("public WireGuard delivery includes a working all-servers iOS profile URL", async () => {
  const { publicWireGuardDeliveryLinks } = await loadLinks();
  const links = publicWireGuardDeliveryLinks("subscription-token", "panel_one", [
    { id: "server-1", name: "One" },
    { id: "server-2", name: "Two" },
  ]);

  assert.equal(
    links.bundle_mobileconfig_url,
    "/api/public/subscription/subscription-token/wireguard/mobileconfig/panel_one",
  );
  assert.equal(links.locations.length, 2);
  assert.match(links.locations[0].mobileconfig_url, /mobileconfig\/panel_one\/server-1$/);
  assert.match(links.locations[1].config_url, /config\/panel_one\/server-2$/);
});
