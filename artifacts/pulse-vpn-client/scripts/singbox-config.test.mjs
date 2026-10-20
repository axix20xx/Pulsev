import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSingBoxConfig } from '../lib/singbox-config.ts';

test('uses a direct bootstrap resolver for proxy hostnames and tunneled DNS for app traffic', () => {
  const config = JSON.parse(buildSingBoxConfig(
    'vless://11111111-1111-4111-8111-111111111111@node.example:443?security=tls&type=tcp&sni=node.example',
    'Test node',
  ));

  const bootstrap = config.dns.servers.find((server) => server.tag === 'bootstrap-dns');
  const remote = config.dns.servers.find((server) => server.tag === 'remote-dns');

  assert.equal(bootstrap?.detour, 'direct');
  assert.equal(remote?.detour, 'proxy');
  assert.equal(config.route.default_domain_resolver, 'bootstrap-dns');
  assert.equal(config.outbounds[0].server, 'node.example');
});
