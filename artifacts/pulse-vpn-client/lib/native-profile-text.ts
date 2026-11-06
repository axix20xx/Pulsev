export function requireNativeString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} باید متن معتبر باشد.`);
  }
  return value;
}

export function requireNativeProfileText(value: unknown, protocol: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() === '[object Object]') {
    throw new Error(`پیکربندی ${protocol} به‌صورت متن معتبر دریافت نشد. دوباره تلاش کنید.`);
  }
  return value;
}
