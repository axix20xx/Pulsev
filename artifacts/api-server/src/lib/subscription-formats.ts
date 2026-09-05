type ClashProxy = Record<string, unknown>;

export type SubscriptionClientFormat = "clash" | "uri";

function decodeBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodedSubscription(body: string): string {
  const trimmed = body.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length >= 16 && /^[A-Za-z0-9+/=_-]+$/.test(compact)) {
    try {
      const decoded = decodeBase64(compact).trim();
      if (/(?:vless|vmess|trojan|ss|ssr|hysteria2?|tuic):\/\//i.test(decoded)) {
        return decoded;
      }
    } catch {
      // Keep the original body when it is not a subscription payload.
    }
  }
  return trimmed;
}

function proxyName(raw: string, fallback: string): string {
  try {
    const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : "";
    return fragment ? decodeURIComponent(fragment) : fallback;
  } catch {
    return fallback;
  }
}

function queryBoolean(value: string | null): boolean {
  return value === "1" || value === "true";
}

function transportOptions(proxy: ClashProxy, query: URLSearchParams): void {
  const network = query.get("type") || "tcp";
  proxy.network = network;
  if (network === "ws") {
    proxy["ws-opts"] = {
      path: query.get("path") || "/",
      headers: query.get("host") ? { Host: query.get("host") } : {},
    };
  } else if (network === "grpc") {
    proxy["grpc-opts"] = {
      "grpc-service-name": query.get("serviceName") || query.get("service-name") || "",
    };
  } else if (network === "http" || network === "h2") {
    proxy["http-opts"] = {
      path: [query.get("path") || "/"],
      headers: query.get("host") ? { Host: [query.get("host")] } : {},
    };
  }
}

function tlsOptions(proxy: ClashProxy, query: URLSearchParams): void {
  const security = (query.get("security") || "").toLowerCase();
  if (security !== "tls" && security !== "reality") return;
  proxy.tls = true;
  proxy.servername = query.get("sni") || query.get("serverName") || undefined;
  proxy["client-fingerprint"] = query.get("fp") || "chrome";
  proxy["skip-cert-verify"] = queryBoolean(query.get("allowInsecure"));
  if (security === "reality") {
    proxy["reality-opts"] = {
      "public-key": query.get("pbk") || "",
      "short-id": query.get("sid") || "",
    };
  }
}

function parseVless(raw: string, index: number): ClashProxy | null {
  try {
    const url = new URL(raw);
    const proxy: ClashProxy = {
      name: proxyName(raw, `Pulse ${index}`),
      type: "vless",
      server: url.hostname,
      port: Number(url.port || 443),
      uuid: decodeURIComponent(url.username),
      udp: true,
    };
    const flow = url.searchParams.get("flow");
    if (flow) proxy.flow = flow;
    const packetEncoding = url.searchParams.get("packetEncoding");
    if (packetEncoding) proxy["packet-encoding"] = packetEncoding;
    transportOptions(proxy, url.searchParams);
    tlsOptions(proxy, url.searchParams);
    return proxy;
  } catch {
    return null;
  }
}

function parseTrojan(raw: string, index: number): ClashProxy | null {
  try {
    const url = new URL(raw);
    const proxy: ClashProxy = {
      name: proxyName(raw, `Pulse ${index}`),
      type: "trojan",
      server: url.hostname,
      port: Number(url.port || 443),
      password: decodeURIComponent(url.username),
      udp: true,
    };
    transportOptions(proxy, url.searchParams);
    tlsOptions(proxy, new URLSearchParams({ ...Object.fromEntries(url.searchParams), security: "tls" }));
    return proxy;
  } catch {
    return null;
  }
}

function parseVmess(raw: string, index: number): ClashProxy | null {
  try {
    const payload = JSON.parse(decodeBase64(raw.slice("vmess://".length).split("#")[0]));
    const network = String(payload.net || payload.network || "tcp");
    const proxy: ClashProxy = {
      name: String(payload.ps || `Pulse ${index}`),
      type: "vmess",
      server: String(payload.add),
      port: Number(payload.port || 443),
      uuid: String(payload.id),
      alterId: Number(payload.aid || 0),
      cipher: String(payload.scy || "auto"),
      udp: true,
      network,
    };
    if (String(payload.tls || "").toLowerCase() === "tls") {
      proxy.tls = true;
      proxy.servername = String(payload.sni || payload.host || payload.add);
      proxy["client-fingerprint"] = String(payload.fp || "chrome");
      proxy["skip-cert-verify"] = false;
    }
    if (network === "ws") {
      proxy["ws-opts"] = {
        path: String(payload.path || "/"),
        headers: payload.host ? { Host: String(payload.host) } : {},
      };
    } else if (network === "grpc") {
      proxy["grpc-opts"] = { "grpc-service-name": String(payload.path || payload.serviceName || "") };
    }
    return proxy;
  } catch {
    return null;
  }
}

function parseShadowsocks(raw: string, index: number): ClashProxy | null {
  try {
    const value = raw.slice("ss://".length);
    const [withoutFragment] = value.split("#");
    const at = withoutFragment.lastIndexOf("@");
    if (at < 0) return null;
    let credentials = withoutFragment.slice(0, at);
    const endpoint = withoutFragment.slice(at + 1).split("?")[0];
    if (!credentials.includes(":")) credentials = decodeBase64(credentials);
    const separator = credentials.indexOf(":");
    if (separator < 1) return null;
    const endpointUrl = new URL(`ss://${endpoint}`);
    return {
      name: proxyName(raw, `Pulse ${index}`),
      type: "ss",
      server: endpointUrl.hostname,
      port: Number(endpointUrl.port),
      cipher: credentials.slice(0, separator),
      password: credentials.slice(separator + 1),
      udp: true,
    };
  } catch {
    return null;
  }
}

function parseProxy(raw: string, index: number): ClashProxy | null {
  const value = raw.trim();
  if (/^vless:\/\//i.test(value)) return parseVless(value, index);
  if (/^vmess:\/\//i.test(value)) return parseVmess(value, index);
  if (/^trojan:\/\//i.test(value)) return parseTrojan(value, index);
  if (/^ss:\/\//i.test(value)) return parseShadowsocks(value, index);
  return null;
}

function yamlScalar(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return '""';
  return JSON.stringify(String(value));
}

function yaml(value: unknown, indent = 0): string {
  const space = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${space}[]`;
    return value.map((item) => {
      if (item && typeof item === "object") {
        const lines = yaml(item, indent + 2).split("\n");
        return `${space}- ${lines[0].trimStart()}\n${lines.slice(1).join("\n")}`;
      }
      return `${space}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => {
        if (item && typeof item === "object") return `${space}${key}:\n${yaml(item, indent + 2)}`;
        return `${space}${key}: ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  return `${space}${yamlScalar(value)}`;
}

export function requestedSubscriptionFormat(
  userAgent: string,
  explicitFormat?: string,
): SubscriptionClientFormat {
  if (/^(clash|mihomo|yaml)$/i.test(explicitFormat || "")) return "clash";
  return /clash|mihomo|clashplus|stash/i.test(userAgent) ? "clash" : "uri";
}

export function toClashSubscription(body: string): string | null {
  const links = decodedSubscription(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const proxies = links
    .map((link, index) => parseProxy(link, index + 1))
    .filter((proxy): proxy is ClashProxy => Boolean(proxy));
  if (!proxies.length) return null;
  const names = proxies.map((proxy) => String(proxy.name));
  return `${yaml({
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    ipv6: false,
    proxies,
    "proxy-groups": [
      { name: "Pulse", type: "select", proxies: ["Auto", ...names] },
      {
        name: "Auto",
        type: "url-test",
        proxies: names,
        url: "https://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 50,
      },
    ],
    rules: ["MATCH,Pulse"],
  })}\n`;
}