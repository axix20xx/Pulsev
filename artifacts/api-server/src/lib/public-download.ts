export type PublicDownloadExtension = ".conf" | ".txt" | ".mobileconfig";

const knownConfigExtensions = /\.(?:conf|txt|cfg|config|mobileconfig)$/i;

export function safeDownloadFilename(
  contentDisposition: string | null,
  fallback: string,
  extension: PublicDownloadExtension,
): string {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''"?([^;"\r\n]+)"?/i)?.[1];
  const plain = contentDisposition?.match(/filename="?([^";\r\n]+)"?/i)?.[1];
  let filename = fallback;
  try {
    if (encoded) filename = decodeURIComponent(encoded);
    else if (plain) filename = plain;
  } catch {
    filename = fallback;
  }

  filename = filename
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[:\u0000-\u001f\u007f"]/g, "_")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .trim()
    .slice(0, 120);
  if (!filename) filename = fallback;

  // Providers sometimes label WireGuard text as .txt; the app-specific suffix
  // is authoritative so Android and iOS receive a file the target app accepts.
  filename = filename.replace(knownConfigExtensions, "").trim();
  if (!filename) filename = "Pulse-config";
  return `${filename}${extension}`;
}

export function attachmentDisposition(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function publicConfigContentType(extension: PublicDownloadExtension): string {
  if (extension === ".mobileconfig") return "application/x-apple-aspen-config";
  if (extension === ".conf") return "application/octet-stream";
  return "text/plain; charset=utf-8";
}
