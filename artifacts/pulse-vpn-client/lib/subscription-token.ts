function tokenFromPath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const subscriptionIndex = segments.lastIndexOf('subscription');
  if (subscriptionIndex >= 0 && segments[subscriptionIndex + 1]) {
    return segments[subscriptionIndex + 1];
  }

  const subIndex = segments.lastIndexOf('sub');
  if (subIndex >= 0) return segments[subIndex + 1] ?? '';

  const lastSegment = segments[segments.length - 1] ?? '';
  return lastSegment.toLowerCase() === 'sub' ? '' : lastSegment;
}

export function getSubscriptionToken(value: string | null): string {
  if (!value) return '';
  try {
    const url = new URL(value, 'https://pulse.invalid');
    const queryToken = (url.searchParams.get('t') ?? url.searchParams.get('token') ?? '').trim();
    return queryToken || tokenFromPath(url.pathname);
  } catch {
    const [path, query = ''] = value.split('?', 2);
    const params = new URLSearchParams(query);
    const queryToken = (params.get('t') ?? params.get('token') ?? '').trim();
    return queryToken || tokenFromPath(path);
  }
}
