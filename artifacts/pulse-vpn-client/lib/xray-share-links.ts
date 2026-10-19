const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SUPPORTED_SHARE_LINK = /(?:^|\s)(?:vless|vmess|trojan|ss|ssr|hysteria2|hy2|tuic|socks|http):\/\//i;

function decodeBase64Utf8(value: string): string | null {
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

export function normalizeXrayShareLinks(subscriptionText: string): {
  text: string;
  wasBase64: boolean;
  linkCount: number;
} {
  const source = subscriptionText.trim();
  if (!source) return { text: '', wasBase64: false, linkCount: 0 };

  const decoded = decodeBase64Utf8(source);
  const candidates = [
    { text: source, wasBase64: false },
    ...(decoded ? [{ text: decoded.trim(), wasBase64: true }] : []),
  ];
  const parsed = candidates.find((candidate) => SUPPORTED_SHARE_LINK.test(candidate.text));
  if (!parsed) return { text: source, wasBase64: false, linkCount: 0 };

  const links = parsed.text.match(/(?:^|\s)(?:vless|vmess|trojan|ss|ssr|hysteria2|hy2|tuic|socks|http):\/\//gi);
  return {
    ...parsed,
    linkCount: links?.length ?? 0,
  };
}
