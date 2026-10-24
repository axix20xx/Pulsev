import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadModule(path) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

const config = (privateKey) => `[Interface]
PrivateKey = ${privateKey}
Address = 10.8.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = server-public-key
Endpoint = wg.example.test:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;

test("PasarGuard WireGuard ZIP becomes stable named .conf locations", async () => {
  const [{ createZipArchive }, { parsePasarGuardWireGuardArchive }] = await Promise.all([
    loadModule("../src/lib/zip-archive.ts"),
    loadModule("../src/lib/pasarguard-wireguard-archive.ts"),
  ]);
  const archive = createZipArchive([
    { name: "Germany_01.conf", content: config("private-key-one") },
    { name: "ایران-مرکزی.conf", content: config("private-key-two") },
  ]);

  const profiles = parsePasarGuardWireGuardArchive(archive);
  assert.equal(profiles.length, 2);
  assert.deepEqual(profiles.map((profile) => profile.name), ["Germany 01", "ایران مرکزی"]);
  assert.match(profiles[0].id, /^pg-[a-f0-9]{20}$/);
  assert.equal(profiles[0].id, parsePasarGuardWireGuardArchive(archive)[0].id);
  assert.equal(profiles[0].fileName, "Germany_01.conf");
  assert.match(profiles[0].body, /PrivateKey = private-key-one/);
  assert.match(profiles[1].body, /PublicKey = server-public-key/);
});

test("PasarGuard WireGuard archive rejects invalid, empty, and oversized files", async () => {
  const [{ createZipArchive }, { parsePasarGuardWireGuardArchive }] = await Promise.all([
    loadModule("../src/lib/zip-archive.ts"),
    loadModule("../src/lib/pasarguard-wireguard-archive.ts"),
  ]);
  assert.throws(() => parsePasarGuardWireGuardArchive(Buffer.from("not a ZIP")), /invalid WireGuard ZIP/);
  assert.throws(
    () => parsePasarGuardWireGuardArchive(createZipArchive([{ name: "readme.txt", content: "not a config" }])),
    /no usable WireGuard \.conf files/,
  );
  assert.throws(
    () => parsePasarGuardWireGuardArchive(createZipArchive([{ name: "broken.conf", content: "[Interface]\n" }])),
    /without a usable Interface and Peer config/,
  );
  assert.throws(
    () => parsePasarGuardWireGuardArchive(Buffer.alloc(8 * 1024 * 1024 + 1)),
    /exceeds the supported size/,
  );
});

test("PasarGuard WireGuard archive rejects corrupt config data", async () => {
  const [{ createZipArchive }, { parsePasarGuardWireGuardArchive }] = await Promise.all([
    loadModule("../src/lib/zip-archive.ts"),
    loadModule("../src/lib/pasarguard-wireguard-archive.ts"),
  ]);
  const archive = createZipArchive([{ name: "server.conf", content: config("private-key") }]);
  const damaged = Buffer.from(archive);
  damaged[41] ^= 0x01;
  assert.throws(
    () => parsePasarGuardWireGuardArchive(damaged),
    /damaged or oversized WireGuard config|damaged WireGuard config|without a usable/,
  );
});
