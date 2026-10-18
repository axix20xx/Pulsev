import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'pulse.mobile.access-token';

export async function getMobileToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveMobileToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearMobileToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
