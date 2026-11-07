export async function loadOptionalMobileConfigSource<T>(
  source: string,
  load: () => Promise<T>,
  skippedSources: Set<string>,
  onFailure: (source: string, error: unknown) => void,
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    skippedSources.add(source);
    onFailure(source, error);
    return undefined;
  }
}
