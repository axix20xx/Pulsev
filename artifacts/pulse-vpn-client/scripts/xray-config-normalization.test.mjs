import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeXrayRealityOutboundSettings } from '../lib/xray-config-normalization.ts';

test('repairs Xray Reality client settings from the selected VLESS URI', () => {
  const publicKey = 'A'.repeat(43);
  const config = {
    outbounds: [{
      protocol: 'vless',
      streamSettings: {
        security: 'reality',
        realitySettings: {
          privateKey: '',
          publicKey: 'stale-converter-value',
          serverNames: [],
        },
      },
    }],
  };
  const link = `vless://user@203.0.113.5:443?security=reality&type=tcp&pbk=${publicKey}&sni=cdn.example.com&sid=ab12&fp=chrome&spx=%2F`;

  const repaired = normalizeXrayRealityOutboundSettings(config, link);
  const reality = config.outbounds[0].streamSettings.realitySettings;

  assert.equal(repaired, 1);
  assert.equal(reality.privateKey, undefined);
  assert.equal(reality.publicKey, publicKey);
  assert.equal(reality.serverName, 'cdn.example.com');
  assert.deepEqual(reality.serverNames, ['cdn.example.com']);
  assert.equal(reality.shortId, 'ab12');
  assert.equal(reality.fingerprint, 'chrome');
  assert.equal(reality.spiderX, '/');
});

test('does not invent Reality keys for an incomplete VLESS URI', () => {
  const config = {
    outbounds: [{
      streamSettings: {
        security: 'reality',
        realitySettings: { privateKey: '', serverNames: [] },
      },
    }],
  };

  assert.throws(
    () => normalizeXrayRealityOutboundSettings(
      config,
      'vless://user@203.0.113.5:443?security=reality&type=tcp&sni=cdn.example.com',
    ),
    /public key \(pbk\) or password/,
  );
});

test('leaves non-Reality Xray outbounds unchanged', () => {
  const config = {
    outbounds: [{
      streamSettings: { security: 'tls', tlsSettings: { serverName: 'cdn.example.com' } },
    }],
  };

  assert.equal(
    normalizeXrayRealityOutboundSettings(config, 'vless://user@example.com:443?security=tls'),
    0,
  );
});
