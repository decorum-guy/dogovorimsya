export const supportsPush = () => globalThis.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export async function withPushDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Устройство долго не отвечает. Проверь связь и попробуй ещё раз.')), 20_000); })]); }
  finally { clearTimeout(timer!); }
}
export function publicKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(key.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export async function currentSubscription() {
  if (!supportsPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return await registration?.pushManager.getSubscription() || null;
}
export async function forgetDeviceSubscription() {
  try {
    const subscription = await currentSubscription();
    await subscription?.unsubscribe();
    const registration = await navigator.serviceWorker.getRegistration('/');
    for (const notification of await registration?.getNotifications() || []) notification.close();
  } catch { /* Server session deletion already revokes delivery to this device. */ }
}
