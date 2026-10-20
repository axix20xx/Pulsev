const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SHARE_LINK_PATTERN = /(?:vless|vmess|trojan|ssr|ss|hysteria2|hy2|tuic|socks|http):\/\/[^\s]+/gi;

export type XrayShareServer = {
  id: string;
  name: string;
  protocol: string;
  link: string;
  host?: string;
  port?: number;
};

export function decodeBase64Utf8(value: string): string | null {
  const compact = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (compact.length < 8 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    return null;
  }

  const unpadded = compact.replace(/=+$/, '');
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;

  for (const character of unpadded) {
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit < 0) return null;
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }

  try {
    const encoded = bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function selectShareText(subscriptionText: string): {
  text: string;
  wasBase64: boolean;
} {
  const source = subscriptionText.trim();
  if (!source) return { text: '', wasBase64: false };

  const decoded = decodeBase64Utf8(source);
  const candidates = [
    { text: source, wasBase64: false },
    ...(decoded ? [{ text: decoded.trim(), wasBase64: true }] : []),
  ];
  const parsed = candidates.find((candidate) => SHARE_LINK_PATTERN.test(candidate.text));
  SHARE_LINK_PATTERN.lastIndex = 0;
  return parsed ?? { text: source, wasBase64: false };
}

function linksIn(text: string): string[] {
  SHARE_LINK_PATTERN.lastIndex = 0;
  return (text.match(SHARE_LINK_PATTERN) ?? []).map((link) => link.replace(/[;,]+$/, ''));
}

function parseHostPort(address: string): { host?: string; port?: number } {
  let endpoint = address.trim().replace(/\/.*$/, '');
  const at = endpoint.lastIndexOf('@');
  if (at >= 0) endpoint = endpoint.slice(at + 1);

  let host = '';
  let portText = '';
  if (endpoint.startsWith('[')) {
    const close = endpoint.indexOf(']');
    if (close < 0) return {};
    host = endpoint.slice(1, close);
    portText = endpoint.slice(close + 1).replace(/^:/, '');
  } else {
    const colon = endpoint.lastIndexOf(':');
    if (colon < 0) return {};
    host = endpoint.slice(0, colon);
    portText = endpoint.slice(colon + 1);
  }

  try {
    host = decodeURIComponent(host);
  } catch {
    // Keep the literal host if a provider supplied malformed percent-encoding.
  }
  const port = Number(portText);
  if (!host || /[\s/@]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return {};
  return { host, port };
}

function decodeLabel(fragment: string): string {
  if (!fragment) return '';
  try {
    return decodeURIComponent(fragment.replace(/\+/g, ' ')).trim();
  } catch {
    return fragment.trim();
  }
}

function parseServer(link: string, index: number): XrayShareServer {
  const delimiter = link.indexOf('://');
  const protocol = delimiter >= 0 ? link.slice(0, delimiter).toLowerCase() : 'unknown';
  const body = delimiter >= 0 ? link.slice(delimiter + 3) : '';
  const hashAt = body.indexOf('#');
  const fragment = hashAt >= 0 ? body.slice(hashAt + 1) : '';
  const withoutFragment = hashAt >= 0 ? body.slice(0, hashAt) : body;
  const queryAt = withoutFragment.indexOf('?');
  const endpoint = queryAt >= 0 ? withoutFragment.slice(0, queryAt) : withoutFragment;
  let address: { host?: string; port?: number } = {};
  let name = decodeLabel(fragment);

  if (protocol === 'vmess') {
    const decoded = decodeBase64Utf8(endpoint);
    if (decoded) {
      try {
        const config = JSON.parse(decoded) as { add?: unknown; port?: unknown; ps?: unknown };
        const host = typeof config.add === 'string' ? config.add.trim() : '';
        const port = Number(config.port);
        if (host && Number.isInteger(port) && port > 0 && port <= 65535) address = { host, port };
        if (!name && typeof config.ps === 'string') name = config.ps.trim();
      } catch {
        // The link remains selectable even when it cannot be inspected for ping.
      }
    }
  } else if (protocol === 'ssr') {
    const decoded = decodeBase64Utf8(endpoint);
    if (decoded) {
      const ssrAddress = decoded.split('/')[0];
      const firstColon = ssrAddress.indexOf(':');
      const secondColon = ssrAddress.indexOf(':', firstColon + 1);
      if (firstColon > 0 && secondColon > firstColon) {
        address = parseHostPort(`${ssrAddress.slice(0, firstColon)}:${ssrAddress.slice(firstColon + 1, secondColon)}`);
      }
    }
  } else if (protocol === 'ss' && !endpoint.includes('@')) {
    const decoded = decodeBase64Utf8(endpoint);
    if (decoded) address = parseHostPort(decoded);
  } else {
    address = parseHostPort(endpoint);
  }

  if (!name) name = address.host ?? `Server ${index + 1}`;
  return {
    id: `${index}:${protocol}:${address.host ?? 'unparsed'}:${address.port ?? 0}`,
    name,
    protocol,
    link,
    ...address,
  };
}

export function parseXrayShareLinks(subscriptionText: string): XrayShareServer[] {
  const selected = selectShareText(subscriptionText);
  return linksIn(selected.text).map((link, index) => parseServer(link, index));
}

export function normalizeXrayShareLinks(subscriptionText: string): {
  text: string;
  wasBase64: boolean;
  linkCount: number;
} {
  const parsed = selectShareText(subscriptionText);
  return {
    ...parsed,
    linkCount: linksIn(parsed.text).length,
  };
}
