export function friendlyServerName(name: string, index: number): string {
  const value = name
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/\uFE0F/g, '')
    .trim();
  const sensitive = /:\/\/|@|(?:vless|vmess|trojan|ss|hysteria|tuic):/i.test(value)
    || /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(value)
    || /(?:password|passwd|token|uuid|private.?key|secret)\s*[:=]/i.test(value);
  const rawEndpoint = /^[\d.:]+$/.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
  if (!value || sensitive || rawEndpoint || /^server\s+\d+$/i.test(value)) return `سرور ${index + 1}`;
  return value.slice(0, 48);
}
