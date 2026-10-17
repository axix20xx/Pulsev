import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/subscription-provider-labels.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { providerConfigLabel, subscriptionProviderShortCodes } =
  await import(`data:text/javascript;base64,${code}`);

test("subscription provider labels use recognizable three-letter names", () => {
  const codes = subscriptionProviderShortCodes([
    { key: "panel_new", kind: "azadpanel_v2ray" },
    { key: "panel_wire", kind: "azadpanel_wireguard" },
    { key: "rain_admin", kind: "rain_admin" },
    { key: "marzban", kind: "marzban" },
  ]);

  assert.equal(codes.get("panel_new"), "NEW");
  assert.equal(codes.get("panel_wire"), "WIR");
  assert.equal(codes.get("rain_admin"), "RAI");
  assert.equal(codes.get("marzban"), "MAR");
  assert.equal(providerConfigLabel("new", "🇩🇪", 1), "NEW - 🇩🇪 01");
});

test("identical provider abbreviations still produce distinct three-letter codes", () => {
  const codes = subscriptionProviderShortCodes([
    { key: "panel_vendor_a", kind: "marzban" },
    { key: "panel_vendor_b", kind: "marzban" },
  ]);
  const values = [...codes.values()];

  assert.equal(values.length, 2);
  assert.equal(new Set(values).size, 2);
  assert.ok(values.every((code) => /^[A-Z]{3}$/.test(code)));
});
