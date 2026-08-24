import type { StoredDraft } from './types';

const DRAFT_PREFIX = 'evening-note:draft';

export function draftKey(userId: string, date: string): string {
  return `${DRAFT_PREFIX}:${userId}:${date}`;
}

export function readDraft(userId: string, date: string): StoredDraft | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(draftKey(userId, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (
      typeof parsed.content !== 'string' ||
      parsed.date !== date ||
      typeof parsed.timezone !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.updatedAt))
    ) {
      return null;
    }
    return parsed as StoredDraft;
  } catch {
    return null;
  }
}

export function shouldRestoreDraft(
  storedDraft: StoredDraft | null,
  serverContent: string,
  serverUpdatedAt?: string,
): boolean {
  if (!storedDraft || storedDraft.content === serverContent) return false;
  if (!serverUpdatedAt) return true;

  const draftTimestamp = Date.parse(storedDraft.updatedAt);
  const serverTimestamp = Date.parse(serverUpdatedAt);
  if (!Number.isFinite(draftTimestamp)) return false;
  if (!Number.isFinite(serverTimestamp)) return true;
  return draftTimestamp > serverTimestamp;
}

export function writeDraft(
  userId: string,
  date: string,
  timezone: string,
  content: string,
): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const draft: StoredDraft = {
      content,
      date,
      timezone,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(draftKey(userId, date), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(userId: string, date: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(draftKey(userId, date));
    return true;
  } catch {
    return false;
  }
}

export function clearUserDrafts(userId: string): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const userPrefix = `${DRAFT_PREFIX}:${userId}:`;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(userPrefix)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
    return true;
  } catch {
    return false;
  }
}

export function getInstallationId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  const fallback = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (typeof window === 'undefined') return fallback;

  const key = 'evening-note:installation-id';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() ?? fallback;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return fallback;
  }
}
