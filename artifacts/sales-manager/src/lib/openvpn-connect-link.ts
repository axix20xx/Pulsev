/**
 * OpenVPN Connect's import-profile link expects the HTTPS profile URL literally
 * after the scheme path. Do not percent-encode the nested URL.
 */
export function openVpnConnectImportUrl(profileUrl: string, pageOrigin: string): string | null {
  try {
    const origin = new URL(pageOrigin);
    const profile = new URL(profileUrl, origin);
    if (
      origin.protocol !== "https:" ||
      profile.protocol !== "https:" ||
      profile.origin !== origin.origin ||
      profile.username ||
      profile.password
    ) {
      return null;
    }
    return `openvpn://import-profile/${profile.toString()}`;
  } catch {
    return null;
  }
}
