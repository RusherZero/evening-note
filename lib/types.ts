export type Entry = {
  id: string;
  user_id: string;
  entry_date: string;
  content: string;
  saved_timezone: string;
  created_at: string;
  updated_at: string;
};

export type AppView = 'today' | 'history' | 'settings';

export type ReminderState =
  | 'unsupported'
  | 'needs-install'
  | 'default'
  | 'registering'
  | 'enabled'
  | 'needs-sync'
  | 'denied'
  | 'error';

export type StoredDraft = {
  content: string;
  date: string;
  timezone: string;
  updatedAt: string;
};

export type PushSubscriptionPayload = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};
