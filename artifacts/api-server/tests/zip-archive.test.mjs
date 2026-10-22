import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadZipArchive() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/zip-archive.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

test("WireGuard archive contains individual UTF-8 .conf files", async () => {
  const { createZipArchive } = await loadZipArchive();
  const archive = createZipArchive([
    { name: "Pulse-01.conf", content: "[Interface]\nPrivateKey = secret-one\n" },
    { name: "Pulse-ایران.conf", content: "[Interface]\nPrivateKey = secret-two\n" },
  ]);

  const files = [];
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedLength = archive.readUInt32LE(offset + 18);
    const filenameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const filename = archive.toString("utf8", nameStart, nameStart + filenameLength);
    const bodyStart = nameStart + filenameLength + extraLength;
    const body = inflateRawSync(archive.subarray(bodyStart, bodyStart + compressedLength)).toString("utf8");
    files.push({ filename, body });
    offset = bodyStart + compressedLength;
  }

  assert.deepEqual(files.map((file) => file.filename), ["Pulse-01.conf", "Pulse-ایران.conf"]);
  assert.match(files[0].body, /PrivateKey = secret-one/);
  assert.match(files[1].body, /PrivateKey = secret-two/);
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});

test("ZIP archive rejects duplicate names and empty or unsafe filenames", async () => {
  const { createZipArchive } = await loadZipArchive();
  assert.throws(() => createZipArchive([]), /between 1 and 65,535/);
  assert.throws(() => createZipArchive([
    { name: "same.conf", content: "one" },
    { name: "same.conf", content: "two" },
  ]), /duplicate filenames/);
  assert.throws(() => createZipArchive([{ name: "../", content: "config" }]), /safe filename/);
});
