import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/pasarguard-groups.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { parsePasarGuardGroupIds } = await import(`data:text/javascript;base64,${code}`);

test("reads and deduplicates every valid PasarGuard group ID", () => {
  assert.deepEqual(
    parsePasarGuardGroupIds([
      { id: 2, name: "basic" },
      { id: "7", name: "premium" },
      { id: 2, name: "duplicate" },
      { id: -1 },
      { id: "not-an-id" },
      null,
    ]),
    [2, 7],
  );
});

test("parses simple and nested group-list response shapes", () => {
  assert.deepEqual(parsePasarGuardGroupIds({ data: [{ id: 3 }, { id: 9 }] }), [3, 9]);
  assert.deepEqual(parsePasarGuardGroupIds({ data: { groups: [{ id: 4 }] } }), [4]);
  assert.deepEqual(parsePasarGuardGroupIds({ groups: [{ id: 5 }] }), [5]);
});
