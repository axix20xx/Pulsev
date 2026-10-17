export type SubscriptionProviderIdentity = {
  key?: string;
  kind?: string;
  api_base?: string;
};

const GENERIC_LABEL_PARTS = new Set([
  "admin",
  "api",
  "azad",
  "azadpanel",
  "com",
  "net",
  "org",
  "panel",
  "provider",
  "www",
]);

function tokens(value: string): string[] {
  return value.split(/[^a-z0-9]+/i).filter(Boolean);
}

function preferredProviderPart(provider: SubscriptionProviderIdentity): string {
  const key = provider.key?.trim() ?? "";
  const host = (() => {
    try {
      return new URL(provider.api_base ?? "").hostname;
    } catch {
      return "";
    }
  })();

  for (const source of [key, host, provider.kind?.trim() ?? ""]) {
    const part = tokens(source)
      .reverse()
      .find((item) => (
        item.replace(/[^a-z]/gi, "").length >= 3
        && !GENERIC_LABEL_PARTS.has(item.toLowerCase())
      ));
    if (part) return part;
  }
  return key || host || provider.kind || "vpn";
}

function threeLetterCode(value: string): string {
  const letters = value.replace(/[^a-z]/gi, "").toUpperCase();
  return (letters || "VPN").slice(0, 3).padEnd(3, "X");
}

function collisionCode(identity: string, attempt: number): string {
  let hash = 2166136261;
  for (const character of `${identity}:${attempt}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let index = 0; index < 3; index += 1) {
    code += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length);
  }
  return code;
}

export function subscriptionProviderShortCodes(
  providers: SubscriptionProviderIdentity[],
): Map<string, string> {
  const codes = new Map<string, string>();
  const used = new Set<string>();

  for (const provider of providers) {
    const identity = provider.key?.trim() || provider.api_base?.trim() || provider.kind?.trim() || "vpn";
    const preferred = threeLetterCode(preferredProviderPart(provider));
    let code = preferred;
    let attempt = 0;
    while (used.has(code)) {
      code = collisionCode(identity, attempt);
      attempt += 1;
    }
    used.add(code);
    codes.set(identity, code);
  }

  return codes;
}

export function providerConfigLabel(providerCode: string, flag: string, index: number): string {
  const code = providerCode.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3).padEnd(3, "X");
  return `${code} - ${flag} ${String(index).padStart(2, "0")}`;
}
