export function samePasarGuardInstance(left: string, right: string): boolean {
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      const path = url.pathname.replace(/\/+$/, "");
      return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}`;
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}
