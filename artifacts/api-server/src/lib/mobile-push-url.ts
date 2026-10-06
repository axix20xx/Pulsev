const allowedPushHosts = new Set([
  "fcm.googleapis.com",
  "web.push.apple.com",
  "updates.push.services.mozilla.com",
]);

const isSubdomainOf = (hostname: string, suffix: string) =>
  hostname !== suffix && hostname.endsWith(`.${suffix}`);

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
    ) {
      return false;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return allowedPushHosts.has(hostname)
      || isSubdomainOf(hostname, "push.apple.com")
      || isSubdomainOf(hostname, "push.services.mozilla.com");
  } catch {
    return false;
  }
}
