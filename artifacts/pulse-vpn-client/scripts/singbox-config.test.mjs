import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSingBoxConfig } from '../lib/singbox-config.ts';

test('uses direct bootstrap DNS and HTTPS DNS over the proxy for app traffic', () => {
  const config = JSON.parse(buildSingBoxConfig(
    'vless://11111111-1111-4111-8111-111111111111@node.example:443?security=tls&type=tcp&sni=node.example',
    'Test node',
  ));

  const bootstrap = config.dns.servers.find((server) => server.tag === 'bootstrap-dns');
  const remote = config.dns.servers.find((server) => server.tag === 'remote-dns');

  assert.equal(bootstrap?.type, 'udp');
  assert.equal(bootstrap?.detour, undefined);
  assert.equal(remote?.type, 'https');
  assert.equal(remote?.server, 'cloudflare-dns.com');
  assert.equal(remote?.server_port, 443);
  assert.equal(remote?.path, '/dns-query');
  assert.equal(remote?.domain_resolver, 'bootstrap-dns');
  assert.equal(remote?.tls?.enabled, true);
  assert.equal(remote?.tls?.server_name, 'cloudflare-dns.com');
  assert.equal(remote?.detour, 'proxy');
  assert.equal(config.route.default_domain_resolver, 'bootstrap-dns');
  assert.equal(config.outbounds[0].server, 'node.example');
  assert.equal(config.inbounds[0].dns_mode, 'hijack');
  assert.equal(config.inbounds[0].mtu, 1400);
  assert.equal(config.inbounds[0].strict_route, undefined);
});
