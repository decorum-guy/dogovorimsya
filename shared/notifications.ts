export const notificationKinds = ['review_created', 'rating_changed', 'comment', 'favorite', 'reaction'] as const;
export type NotificationKind = typeof notificationKinds[number];
export interface NotificationPreferences {
  enabled: boolean;
  events: Record<NotificationKind, boolean>;
  mutedUntil: number | null;
  silent: boolean;
}
export interface NotificationState {
  available: boolean;
  publicKey: string | null;
  preferences: NotificationPreferences;
  deviceCount: number;
}
export const defaultNotificationPreferences = (): NotificationPreferences => ({
  enabled: true,
  events: { review_created: true, rating_changed: true, comment: true, favorite: true, reaction: true },
  mutedUntil: null,
  silent: false,
});
