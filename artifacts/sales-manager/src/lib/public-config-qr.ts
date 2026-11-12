import QRCode from "qrcode";

export async function createPublicConfigQr(url: string): Promise<string> {
  if (typeof window === "undefined") throw new Error("QR codes can only be prepared in a browser.");

  const target = new URL(url, window.location.origin);
  if (
    target.origin !== window.location.origin
    || !target.pathname.startsWith("/api/public/subscription/")
  ) {
    throw new Error("The configuration link is not a trusted subscription URL.");
  }

  const response = await fetch(target.toString(), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The configuration could not be loaded.");

  const config = (await response.text()).trim();
  if (!config || !/^\s*\[Interface\]/m.test(config) || !/^\s*\[Peer\]/m.test(config)) {
    throw new Error("The server did not return a valid WireGuard-style configuration.");
  }

  return QRCode.toDataURL(config, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: { dark: "#17212f", light: "#ffffff" },
  });
}
