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
  assert.equal(config.inbounds[0].mtu, undefined);
  assert.equal(config.inbounds[0].strict_route, undefined);
  assert.deepEqual(config.route.rules, [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
  ]);
});

test('creates a Reality client outbound from the public-key fields in a VLESS link', () => {
  const config = JSON.parse(buildSingBoxConfig(
    'vless://11111111-1111-4111-8111-111111111111@node.example:443?security=reality&type=tcp&sni=node.example&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=abcd',
    'Reality test',
  ));

  assert.equal(config.outbounds[0].tls.reality.enabled, true);
  assert.equal(config.outbounds[0].tls.reality.public_key, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(config.outbounds[0].tls.reality.short_id, 'abcd');
});

test('rejects Reality links that omit the client public key before starting the native engine', () => {
  assert.throws(
    () => buildSingBoxConfig(
      'vless://11111111-1111-4111-8111-111111111111@node.example:443?security=reality&type=tcp&sni=node.example',
      'Incomplete Reality test',
    ),
    /no client public key/,
  );
});

test('converts each advertised share-link protocol to its matching sing-box outbound', () => {
  const vmessConfig = Buffer.from(JSON.stringify({
    add: 'vmess.example',
    port: '443',
    id: '11111111-1111-4111-8111-111111111111',
    net: 'tcp',
    tls: 'tls',
  })).toString('base64');
  const cases = [
    [`vmess://${vmessConfig}`, 'vmess'],
    ['trojan://secret@trojan.example:443?sni=trojan.example', 'trojan'],
    ['ss://aes-128-gcm:secret@ss.example:8388', 'shadowsocks'],
    ['hysteria2://secret@hy2.example:443?sni=hy2.example', 'hysteria2'],
    ['tuic://11111111-1111-4111-8111-111111111111:secret@tuic.example:443?sni=tuic.example', 'tuic'],
    ['http://proxy.example:8080', 'http'],
    ['socks://proxy.example:1080', 'socks'],
  ];

  for (const [link, expectedType] of cases) {
    const config = JSON.parse(buildSingBoxConfig(link, 'Protocol fixture'));
    assert.equal(config.outbounds[0].type, expectedType, `${expectedType} fixture`);
  }
});

test('preserves IPv6 endpoints and WebSocket TLS settings', () => {
  const config = JSON.parse(buildSingBoxConfig(
    'vless://11111111-1111-4111-8111-111111111111@[2001:db8::1]:443?security=tls&type=ws&sni=cdn.example.com&host=cdn.example.com&path=%2Fedge',
    'IPv6 WebSocket fixture',
  ));

  assert.equal(config.outbounds[0].server, '2001:db8::1');
  assert.equal(config.outbounds[0].server_port, 443);
  assert.equal(config.outbounds[0].tls.server_name, 'cdn.example.com');
  assert.equal(config.outbounds[0].transport.type, 'ws');
  assert.equal(config.outbounds[0].transport.path, '/edge');
  assert.equal(config.outbounds[0].transport.headers.Host, 'cdn.example.com');
});

test('rejects SSR and unsupported Shadowsocks plugins rather than silently changing protocols', () => {
  assert.throws(
    () => buildSingBoxConfig(
      'ssr://YWVzLTI1Ni1nY206cGFzc3dvcmRAbm9kZS5leGFtcGxlOjgzODg=',
      'SSR fixture',
    ),
    /SSR protocol is not supported by sing-box/,
  );
  assert.throws(
    () => buildSingBoxConfig(
      'ss://aes-128-gcm:secret@ss.example:8388?plugin=obfs-local',
      'Shadowsocks plugin fixture',
    ),
    /plugin links are not yet supported/,
  );
});

test('rejects V2Ray transports that the converter does not implement', () => {
  assert.throws(
    () => buildSingBoxConfig(
      'vless://11111111-1111-4111-8111-111111111111@node.example:443?type=quic',
      'Unsupported transport fixture',
    ),
    /transport \(quic\) is not supported/,
  );
});
