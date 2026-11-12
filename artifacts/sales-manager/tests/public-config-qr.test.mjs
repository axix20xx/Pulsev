import assert from "node:assert/strict";
import test from "node:test";
import { createPublicConfigQr } from "../src/lib/public-config-qr.ts";

test("creates a QR image from fetched config text, not from the download URL", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestOptions;
  globalThis.window = { location: { origin: "https://pulse.example" } };
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestOptions = options;
    return new Response("[Interface]\nPrivateKey = private-value\n[Peer]\nPublicKey = public-value\n");
  };

  try {
    const image = await createPublicConfigQr("/api/public/subscription/safe-token/awg");
    assert.match(image, /^data:image\/png;base64,/);
    assert.equal(requestedUrl, "https://pulse.example/api/public/subscription/safe-token/awg");
    assert.equal(requestOptions.cache, "no-store");
    assert.equal(requestOptions.credentials, "include");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("rejects cross-origin config links without fetching them", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.window = { location: { origin: "https://pulse.example" } };
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("[Interface]\n[Peer]\n");
  };

  try {
    await assert.rejects(
      () => createPublicConfigQr("https://other.example/config"),
      /trusted subscription URL/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
