import assert from "node:assert/strict";
import test from "node:test";
import { openVpnConnectImportUrl } from "../src/lib/openvpn-connect-link.ts";

test("OpenVPN Connect import links keep the same-origin HTTPS profile URL literal", () => {
  assert.equal(
    openVpnConnectImportUrl("/api/public/subscription/token/openvpn/import-bundle/azad-openvpn", "https://pulse.example"),
    "openvpn://import-profile/https://pulse.example/api/public/subscription/token/openvpn/import-bundle/azad-openvpn",
  );
});

test("OpenVPN Connect import links reject insecure or cross-origin profile URLs", () => {
  assert.equal(
    openVpnConnectImportUrl("/api/public/subscription/token/openvpn/import-bundle/azad-openvpn", "http://pulse.example"),
    null,
  );
  assert.equal(
    openVpnConnectImportUrl("https://other.example/profile.ovpn", "https://pulse.example"),
    null,
  );
});
