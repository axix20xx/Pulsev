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

/**
 * Some share-link converters emit a Reality outbound with an empty serverNames
 * list even when the VLESS URI includes its SNI. Xray rejects that config at
 * startup. Preserve valid converted names and repair only empty/invalid lists.
 */
export function normalizeXrayRealityServerNames(config: unknown, shareLink: string): number {
  const fallbackName = serverNameFromLink(shareLink);
  let repairedProfiles = 0;
  let unresolvedProfiles = 0;

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    const streamSettings = isRecord(value.streamSettings) ? value.streamSettings : null;
    if (streamSettings && String(streamSettings.security ?? '').toLowerCase() === 'reality') {
      const realitySettings = isRecord(streamSettings.realitySettings)
        ? streamSettings.realitySettings
        : {};
      const configuredNames = Array.isArray(realitySettings.serverNames)
        ? realitySettings.serverNames
          .map(validRealityServerName)
          .filter((name): name is string => name !== null)
        : [];

      if (configuredNames.length > 0) {
        realitySettings.serverNames = configuredNames;
      } else {
        const candidate = validRealityServerName(realitySettings.serverName) ?? fallbackName;
        if (candidate) {
          realitySettings.serverNames = [candidate];
          repairedProfiles += 1;
        } else {
          unresolvedProfiles += 1;
        }
      }
      streamSettings.realitySettings = realitySettings;
    }

    Object.values(value).forEach(visit);
  };

  visit(config);

  if (unresolvedProfiles > 0) {
    throw new Error(
      'This Reality profile has no valid server name. The VLESS link must include an sni= value, or use a domain name as its server address.',
    );
  }

  return repairedProfiles;
}
