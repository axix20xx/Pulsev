import { decodeBase64Utf8, normalizeXrayShareLinks } from './xray-share-links.ts';

type JsonObject = Record<string, unknown>;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function numeric(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionalString(value: string | null): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function tlsSettings(query: URLSearchParams, host: string, security: string): JsonObject | undefined {
  if (security !== 'tls' && security !== 'reality') return undefined;

  const serverName = optionalString(query.get('sni') ?? query.get('serverName') ?? query.get('host')) ?? host;
  const tls: JsonObject = {
    enabled: true,
    server_name: serverName,
  };
  const alpn = optionalString(query.get('alpn'));
  if (alpn) tls.alpn = alpn.split(',').map((item) => item.trim()).filter(Boolean);
  if (query.get('allowInsecure') === '1' || query.get('allowInsecure') === 'true' || query.get('insecure') === '1') {
    tls.insecure = true;
  }
  const fingerprint = optionalString(query.get('fp') ?? query.get('fingerprint'));
  if (fingerprint) tls.utls = { enabled: true, fingerprint };

  if (security === 'reality') {
    const publicKey = optionalString(query.get('pbk') ?? query.get('publicKey'));
    const shortId = optionalString(query.get('sid') ?? query.get('shortId'));
    if (!publicKey) {
      throw new Error('This Reality link has no client public key (pbk). Import the complete VLESS link again.');
    }
    tls.reality = { enabled: true, public_key: publicKey, short_id: shortId ?? '' };
  }
  return tls;
}

function transportSettings(query: URLSearchParams, kind: string): JsonObject | undefined {
  if (kind === 'ws' || kind === 'websocket') {
    const headers: JsonObject = {};
    const host = optionalString(query.get('host'));
    if (host) headers.Host = host;
    return {
      type: 'ws',
      path: optionalString(query.get('path')) ?? '/',
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }
  if (kind === 'grpc') {
    return { type: 'grpc', service_name: optionalString(query.get('serviceName') ?? query.get('path')) ?? '' };
  }
  if (kind === 'httpupgrade' || kind === 'http-upgrade') {
    const headers: JsonObject = {};
    const host = optionalString(query.get('host'));
    if (host) headers.Host = host;
    return {
      type: 'httpupgrade',
      path: optionalString(query.get('path')) ?? '/',
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }
  if (kind === 'http' || kind === 'h2') {
    const headers: JsonObject = {};
    const host = optionalString(query.get('host'));
    if (host) headers.Host = host;
    return {
      type: 'http',
      path: optionalString(query.get('path')) ?? '/',
      ...(Object.keys(headers).length ? { host: [host], headers } : {}),
    };
  }
  if (kind === 'tcp' || kind === '') return undefined;
  throw new Error(`This V2Ray transport (${kind}) is not supported by the in-app sing-box engine yet.`);
}

function makeOutbound(link: string, name: string): JsonObject {
  const schemeAt = link.indexOf('://');
  if (schemeAt <= 0) throw new Error('The selected server link is malformed.');
  const protocol = link.slice(0, schemeAt).toLowerCase();
  const body = link.slice(schemeAt + 3);

  if (protocol === 'vmess') {
    const encoded = body.split('#', 1)[0].split('?', 1)[0];
    const decoded = decodeBase64Utf8(encoded);
    if (!decoded) throw new Error('This VMess link is not valid base64.');
    let source: JsonObject;
    try {
      source = JSON.parse(decoded) as JsonObject;
    } catch {
      throw new Error('This VMess link does not contain valid server settings.');
    }
    const host = typeof source.add === 'string' ? source.add.trim() : '';
    const port = Number(source.port);
    const uuid = typeof source.id === 'string' ? source.id.trim() : '';
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !uuid) {
      throw new Error('This VMess link is missing its server, port, or client ID.');
    }
    const network = typeof source.net === 'string' ? source.net.toLowerCase() : 'tcp';
    const query = new URLSearchParams({
      sni: typeof source.sni === 'string' ? source.sni : (typeof source.host === 'string' ? source.host : host),
      path: typeof source.path === 'string' ? source.path : '/',
    });
    const security = typeof source.tls === 'string' && source.tls !== '' && source.tls !== 'none' ? 'tls' : '';
    const tls = security ? tlsSettings(query, host, security) : undefined;
    const transport = transportSettings(query, network);
    return {
      type: 'vmess',
      tag: 'proxy',
      server: host,
      server_port: port,
      uuid,
      alter_id: numeric(source.aid == null ? null : String(source.aid), 0),
      security: typeof source.scy === 'string' && source.scy ? source.scy : 'auto',
      ...(tls ? { tls } : {}),
      ...(transport ? { transport } : {}),
      _display_name: name,
    };
  }

  if (protocol === 'ss' && !body.includes('@')) {
    const decoded = decodeBase64Utf8(body.split('#', 1)[0]);
    if (decoded) {
      const at = decoded.lastIndexOf('@');
      if (at > 0) {
        const rebuilt = `ss://${encodeURIComponent(decoded.slice(0, at))}@${decoded.slice(at + 1)}${body.includes('#') ? `#${body.slice(body.indexOf('#') + 1)}` : ''}`;
        return makeOutbound(rebuilt, name);
      }
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error(`The selected ${protocol.toUpperCase()} link could not be parsed.`);
  }
  const host = decode(parsed.hostname);
  const port = Number(parsed.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The selected server link is missing a valid host or port.');
  }
  const query = parsed.searchParams;
  const transport = transportSettings(query, (query.get('type') ?? query.get('net') ?? 'tcp').toLowerCase());

  if (protocol === 'vless') {
    const uuid = decode(parsed.username);
    if (!uuid) throw new Error('This VLESS link is missing its client UUID.');
    const security = (query.get('security') ?? 'none').toLowerCase();
    const flow = optionalString(query.get('flow'));
    const tls = tlsSettings(query, host, security);
    return {
      type: 'vless',
      tag: 'proxy',
      server: host,
      server_port: port,
      uuid,
      ...(flow ? { flow } : {}),
      ...(tls ? { tls } : {}),
      ...(transport ? { transport } : {}),
      _display_name: name,
    };
  }

  if (protocol === 'trojan') {
    const password = decode(parsed.username);
    if (!password) throw new Error('This Trojan link is missing its password.');
    const tls = tlsSettings(query, host, (query.get('security') ?? 'tls').toLowerCase());
    return {
      type: 'trojan',
      tag: 'proxy',
      server: host,
      server_port: port,
      password,
      ...(tls ? { tls } : {}),
      ...(transport ? { transport } : {}),
      _display_name: name,
    };
  }

  if (protocol === 'ss') {
    let userInfo = `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}`;
    userInfo = decode(userInfo);
    if (!userInfo.includes(':')) {
      const decoded = decodeBase64Utf8(userInfo);
      if (decoded) userInfo = decoded;
    }
    const separator = userInfo.indexOf(':');
    if (separator <= 0) throw new Error('This Shadowsocks link is missing its cipher or password.');
    const plugin = optionalString(query.get('plugin'));
    if (plugin) throw new Error('Shadowsocks plugin links are not yet supported by the in-app engine.');
    return {
      type: 'shadowsocks',
      tag: 'proxy',
      server: host,
      server_port: port,
      method: userInfo.slice(0, separator),
      password: userInfo.slice(separator + 1),
      _display_name: name,
    };
  }

  if (protocol === 'socks' || protocol === 'http') {
    const outbound: JsonObject = {
      type: protocol,
      tag: 'proxy',
      server: host,
      server_port: port,
      _display_name: name,
    };
    if (parsed.username) outbound.username = decode(parsed.username);
    if (parsed.password) outbound.password = decode(parsed.password);
    const tls = query.get('security') === 'tls' ? tlsSettings(query, host, 'tls') : undefined;
    if (tls) outbound.tls = tls;
    return outbound;
  }

  if (protocol === 'hysteria2' || protocol === 'hy2') {
    const password = decode(parsed.username);
    if (!password) throw new Error('This Hysteria 2 link is missing its password.');
    const tls = tlsSettings(query, host, 'tls') ?? { enabled: true, server_name: host };
    const obfsPassword = optionalString(query.get('obfs-password'));
    if (query.get('obfs') === 'salamander' && obfsPassword) {
      (tls as JsonObject);
      return {
        type: 'hysteria2',
        tag: 'proxy',
        server: host,
        server_port: port,
        password,
        tls,
        obfs: { type: 'salamander', password: obfsPassword },
        _display_name: name,
      };
    }
    return {
      type: 'hysteria2',
      tag: 'proxy',
      server: host,
      server_port: port,
      password,
      tls,
      _display_name: name,
    };
  }

  if (protocol === 'tuic') {
    const uuid = decode(parsed.username);
    const password = decode(parsed.password);
    if (!uuid || !password) throw new Error('This TUIC link is missing its UUID or password.');
    return {
      type: 'tuic',
      tag: 'proxy',
      server: host,
      server_port: port,
      uuid,
      password,
      congestion_control: optionalString(query.get('congestion_control')) ?? 'cubic',
      udp_relay_mode: optionalString(query.get('udp_relay_mode')) ?? 'native',
      tls: tlsSettings(query, host, 'tls') ?? { enabled: true, server_name: host },
      _display_name: name,
    };
  }

  throw new Error(`The ${protocol.toUpperCase()} protocol is not supported by sing-box. Choose a VLESS, VMess, Trojan, Shadowsocks, Hysteria 2, TUIC, HTTP, or SOCKS server.`);
}

export function buildSingBoxConfig(subscriptionText: string, profileName: string): string {
  const normalized = normalizeXrayShareLinks(subscriptionText);
  if (!normalized.text || normalized.linkCount === 0) {
    throw new Error('The V2Ray subscription does not contain any readable server links.');
  }

  const firstLink = normalized.text.match(/(?:vless|vmess|trojan|ssr|ss|hysteria2|hy2|tuic|socks|http):\/\/[^\s]+/i)?.[0];
  if (!firstLink) throw new Error('The selected V2Ray server link could not be found.');
  const displayName = profileName.trim() || 'Pulse VPN';
  const outbound = makeOutbound(firstLink.replace(/[;,]+$/, ''), displayName);
  delete outbound._display_name;

  const config = {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        {
          type: 'udp',
          tag: 'bootstrap-dns',
          server: '1.1.1.1',
          server_port: 53,
          detour: 'direct',
        },
        {
          type: 'udp',
          tag: 'remote-dns',
          server: '1.1.1.1',
          server_port: 53,
          detour: 'proxy',
        },
      ],
      final: 'remote-dns',
      strategy: 'prefer_ipv4',
    },
    inbounds: [
      {
        type: 'tun',
        tag: 'pulse-tun',
        interface_name: 'tun0',
        address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
        mtu: 9000,
        auto_route: true,
        strict_route: true,
        stack: 'mixed',
      },
    ],
    outbounds: [outbound, { type: 'direct', tag: 'direct' }, { type: 'block', tag: 'block' }],
    route: {
      auto_detect_interface: true,
      default_domain_resolver: 'bootstrap-dns',
      final: 'proxy',
      rules: [{ action: 'hijack-dns' }, { action: 'sniff' }],
    },
    experimental: { cache_file: { enabled: true } },
    _profile_name: displayName,
  } as JsonObject;
  delete config._profile_name;
  return JSON.stringify(config);
}
