type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isIpLiteral(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, '');
  const ipv4Parts = address.split('.');
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  ) return true;
  return address.includes(':') && /^[0-9a-fA-F:.]+$/.test(address);
}

function validRealityServerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\.$/, '');
  if (
    !name ||
    name.length > 253 ||
    /[\s/@?#]/.test(name) ||
    !/^[a-zA-Z0-9.-]+$/.test(name)
  ) return null;
  return name;
}

function serverNameFromLink(link: string): string | null {
  try {
    const parsed = new URL(link);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!['sni', 'servername', 'server_name'].includes(key.toLowerCase())) continue;
      const serverName = validRealityServerName(value.split(',')[0]);
      if (serverName) return serverName;
    }

    const host = validRealityServerName(parsed.hostname);
    if (host && !isIpLiteral(host)) return host;
  } catch {
    // The caller receives a precise missing-SNI error if the link cannot be parsed.
  }
  return null;
}

function queryValue(link: string, names: readonly string[]): string | null {
  try {
    const accepted = new Set(names.map((name) => name.toLowerCase()));
    const parsed = new URL(link);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!accepted.has(key.toLowerCase())) continue;
      const normalized = value.trim();
      if (normalized) return normalized;
    }
  } catch {
    // The caller reports a specific missing-field error for invalid links.
  }
  return null;
}

/**
 * Share-link converters may leave server-side-only `privateKey` fields empty
 * on a Reality outbound, or omit the outbound public key even though the
 * VLESS URI has `pbk`. Build the client fields from the URI, never reuse a
 * server private key, and reject unusable Reality nodes before starting Xray.
 */
export function normalizeXrayRealityOutboundSettings(config: unknown, shareLink: string): number {
  const linkServerName = serverNameFromLink(shareLink);
  const linkPublicKey = queryValue(shareLink, ['pbk', 'publickey', 'public_key']);
  const linkPassword = queryValue(shareLink, ['password']);
  const linkShortId = queryValue(shareLink, ['sid', 'shortid', 'short_id']);
  const linkFingerprint = queryValue(shareLink, ['fp', 'fingerprint']);
  const linkSpiderX = queryValue(shareLink, ['spx', 'spiderx']);
  let repairedProfiles = 0;
  let unresolvedProfiles = 0;

  const root = isRecord(config) ? config : null;
  const outbounds = root && Array.isArray(root.outbounds) ? root.outbounds : [];
  for (const outbound of outbounds) {
    if (!isRecord(outbound)) continue;
    const streamSettings = isRecord(outbound.streamSettings) ? outbound.streamSettings : null;
    if (!streamSettings || String(streamSettings.security ?? '').toLowerCase() !== 'reality') continue;

    const realitySettings = isRecord(streamSettings.realitySettings)
      ? streamSettings.realitySettings
      : {};

    // REALITY private keys belong to server/inbound configuration only.
    delete realitySettings.privateKey;

    const configuredPublicKey =
      typeof realitySettings.publicKey === 'string' ? realitySettings.publicKey.trim() : '';
    const configuredPassword =
      typeof realitySettings.password === 'string' ? realitySettings.password.trim() : '';
    if (linkPublicKey) realitySettings.publicKey = linkPublicKey;
    if (linkPassword) realitySettings.password = linkPassword;

    const configuredName = validRealityServerName(realitySettings.serverName);
    const configuredNames = Array.isArray(realitySettings.serverNames)
      ? realitySettings.serverNames
        .map(validRealityServerName)
        .filter((name): name is string => name !== null)
      : [];
    const serverName = configuredName ?? configuredNames[0] ?? linkServerName;
    if (serverName) {
      realitySettings.serverName = serverName;
      realitySettings.serverNames = configuredNames.length ? configuredNames : [serverName];
    }

    if (linkShortId && !(typeof realitySettings.shortId === 'string' && realitySettings.shortId.trim())) {
      realitySettings.shortId = linkShortId;
    }
    if (linkFingerprint && !(typeof realitySettings.fingerprint === 'string' && realitySettings.fingerprint.trim())) {
      realitySettings.fingerprint = linkFingerprint;
    }
    if (linkSpiderX && !(typeof realitySettings.spiderX === 'string' && realitySettings.spiderX.trim())) {
      realitySettings.spiderX = linkSpiderX;
    }

    const hasClientKey =
      typeof realitySettings.publicKey === 'string' && !!realitySettings.publicKey.trim() ||
      typeof realitySettings.password === 'string' && !!realitySettings.password.trim();
    if (!hasClientKey || !serverName) {
      unresolvedProfiles += 1;
    } else if (!configuredPublicKey || !configuredName || configuredNames.length === 0) {
      repairedProfiles += 1;
    }

    streamSettings.realitySettings = realitySettings;
  }

  if (unresolvedProfiles > 0) {
    throw new Error(
      'This Reality profile is incomplete. Its VLESS link must include a public key (pbk) or password and a valid sni= value, or use a domain name as its server address.',
    );
  }

  return repairedProfiles;
}
