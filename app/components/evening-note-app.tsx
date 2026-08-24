'use client';
/* eslint-disable react-hooks/set-state-in-effect -- effects synchronize auth, storage, network, and PWA state */

import type { User } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthScreen } from './auth-screen';
import { PasswordRecoveryScreen, type PasswordRecoveryState } from './password-recovery-screen';
import {
  PASSWORD_MIN_LENGTH,
  type AuthFlowMode,
  getCleanAuthCallbackUrl,
  getRecoveryIntent,
  passwordUpdateErrorMessage,
  passwordValidationMessage,
} from '@/lib/auth';
import { isDemoMode, isPushConfigured, isSupabaseConfigured, publicConfig } from '@/lib/config';
import { REMINDER_TIME, formatEntryDate, formatLongDate, getDeviceTimezone, getLocalDateKey } from '@/lib/date';
import {
  clearDraft,
  clearUserDrafts,
  getInstallationId,
  readDraft,
  shouldRestoreDraft,
  writeDraft,
} from '@/lib/draft';
import {
  isAppleMobile,
  isStandalone,
  registerServiceWorker,
  serializeSubscription,
  supportsWebPush,
  urlBase64ToUint8Array,
} from '@/lib/pwa';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { changeAccountPassword } from '@/lib/password-auth';
import { pushFunctionErrorMessage } from '@/lib/push-errors';
import {
  hasNewerDraftEdits,
  isSameOperationScope,
  isSameReconcileScope,
  LatestSerialRunner,
} from '@/lib/operation';
import type { OperationScope } from '@/lib/operation';
import type { AppView, Entry, ReminderState } from '@/lib/types';

const DEMO_USER_ID = 'demo-user';
const DEMO_ENTRIES_KEY = 'evening-note:demo-entries';
const ENTRIES_PAGE_SIZE = 500;
const MAX_ENTRY_PAGES = 20;

type DraftPersistenceContext = {
  content: string;
  date: string;
  ready: boolean;
  serverContent: string;
  timezone: string;
  userId: string;
};

type ReconcileInput = OperationScope & {
  supabase: ReturnType<typeof getSupabaseBrowserClient>;
  timezone: string;
  user: User | null;
};

function viewFromUrl(): AppView {
  if (typeof window === 'undefined') return 'today';
  const requested = new URL(window.location.href).searchParams.get('view');
  return requested === 'history' || requested === 'settings' ? requested : 'today';
}

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

function readDemoEntries(): Entry[] {
  try {
    const value = window.localStorage.getItem(DEMO_ENTRIES_KEY);
    return value ? (JSON.parse(value) as Entry[]) : [];
  } catch {
    return [];
  }
}

function writeDemoEntries(entries: Entry[]): boolean {
  try {
    window.localStorage.setItem(DEMO_ENTRIES_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export function EveningNoteApp() {
  const [recoveryState, setRecoveryState] = useState<PasswordRecoveryState | 'none'>(() => (
    typeof window !== 'undefined' && getRecoveryIntent(window.location.href) === 'recovery'
      ? 'checking'
      : 'none'
  ));
  const [authScreenMode, setAuthScreenMode] = useState<AuthFlowMode>('sign-in');
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [stateOwnerId, setStateOwnerId] = useState(isDemoMode ? DEMO_USER_ID : '');
  const [view, setView] = useState<AppView>('today');
  const [timezone, setTimezone] = useState('UTC');
  const [todayKey, setTodayKey] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState('');
  const [entriesReload, setEntriesReload] = useState(0);
  const [draft, setDraft] = useState('');
  const [hydratedDraftScope, setHydratedDraftScope] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'restored'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [reminderState, setReminderState] = useState<ReminderState>('default');
  const [reminderMessage, setReminderMessage] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const reconcileTimer = useRef<number | null>(null);
  const shouldFocusView = useRef(false);
  const currentUserId = useRef(isDemoMode ? DEMO_USER_ID : '');
  const accountEpoch = useRef(0);
  const draftRef = useRef('');
  const draftRevision = useRef(0);
  const saveInFlight = useRef(false);
  const saveOperationId = useRef(0);
  const todayKeyRef = useRef('');
  const draftPersistence = useRef<DraftPersistenceContext>({
    content: '',
    date: '',
    ready: false,
    serverContent: '',
    timezone: 'UTC',
    userId: '',
  });
  const timezoneRef = useRef('UTC');
  const reconcileInput = useRef<ReconcileInput>({
    epoch: 0,
    supabase,
    timezone: 'UTC',
    user: null,
    userId: isDemoMode ? DEMO_USER_ID : '',
  });
  const reconcileRunner = useRef<LatestSerialRunner<ReconcileInput> | null>(null);
  reconcileRunner.current ??= new LatestSerialRunner<ReconcileInput>();
  const reconcileSuspended = useRef(false);
  const reconcileRequestedWhileSuspended = useRef(false);
  const recoveryStateRef = useRef(recoveryState);

  const userId = isDemoMode ? DEMO_USER_ID : user?.id ?? '';
  const todayEntry = entries.find((entry) => entry.entry_date === todayKey) ?? null;
  const draftScope = userId && todayKey ? `${userId}:${todayKey}` : '';
  const draftReady = Boolean(draftScope && hydratedDraftScope === draftScope && stateOwnerId === userId);

  const isCurrentAccount = useCallback((snapshot: OperationScope) => isSameOperationScope(snapshot, {
    epoch: accountEpoch.current,
    userId: currentUserId.current,
  }), []);

  const applyAuthenticatedUser = useCallback((nextUser: User | null) => {
    const nextUserId = nextUser?.id ?? '';
    if (currentUserId.current !== nextUserId) accountEpoch.current += 1;
    currentUserId.current = nextUserId;
    setUser(nextUser);
  }, []);

  const applyRecoveryState = useCallback((nextState: PasswordRecoveryState | 'none') => {
    recoveryStateRef.current = nextState;
    setRecoveryState(nextState);
  }, []);

  const clearAuthCallbackUrl = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(
      window.history.state,
      '',
      getCleanAuthCallbackUrl(window.location.href),
    );
  }, []);

  useEffect(() => {
    currentUserId.current = userId;
    timezoneRef.current = timezone;
    todayKeyRef.current = todayKey;
    draftRef.current = draft;
    reconcileInput.current = {
      epoch: accountEpoch.current,
      supabase,
      timezone,
      user,
      userId,
    };
    draftPersistence.current = {
      content: draft,
      date: todayKey,
      ready: draftReady,
      serverContent: todayEntry?.content ?? '',
      timezone,
      userId,
    };
  }, [draft, draftReady, supabase, timezone, todayEntry, todayKey, user, userId]);

  const refreshLocalClock = useCallback(() => {
    const nextTimezone = getDeviceTimezone();
    const nextTodayKey = getLocalDateKey(nextTimezone);
    timezoneRef.current = nextTimezone;
    todayKeyRef.current = nextTodayKey;
    setTimezone(nextTimezone);
    setTodayKey(nextTodayKey);
  }, []);

  useEffect(() => {
    setView(viewFromUrl());
    refreshLocalClock();
    setOnline(navigator.onLine);
    void registerServiceWorker();

    const handlePopState = () => {
      shouldFocusView.current = true;
      setView(viewFromUrl());
    };
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshLocalClock();
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    const clockTimer = window.setInterval(refreshLocalClock, 60_000);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(clockTimer);
    };
  }, [refreshLocalClock]);

  useEffect(() => {
    if (!shouldFocusView.current) return;
    shouldFocusView.current = false;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('view-heading')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  useEffect(() => {
    if (isDemoMode) {
      setAuthReady(true);
      return;
    }
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let active = true;
    let authEventVersion = 0;
    let recoveryCheckTimer: number | null = null;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      authEventVersion += 1;
      if (event === 'PASSWORD_RECOVERY') applyRecoveryState('ready');
      applyAuthenticatedUser(session?.user ?? null);
      setAuthReady(true);
    });
    if (recoveryStateRef.current === 'checking') {
      recoveryCheckTimer = window.setTimeout(() => {
        if (active && recoveryStateRef.current === 'checking') {
          applyRecoveryState('error');
        }
      }, 5_000);
    }

    const sessionVersion = authEventVersion;
    void supabase.auth.getSession()
      .then(({ data: sessionData }) => {
        if (!active || authEventVersion !== sessionVersion) return;
        applyAuthenticatedUser(sessionData.session?.user ?? null);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active || authEventVersion !== sessionVersion) return;
        applyAuthenticatedUser(null);
        setAuthReady(true);
      });

    return () => {
      active = false;
      if (recoveryCheckTimer !== null) window.clearTimeout(recoveryCheckTimer);
      data.subscription.unsubscribe();
    };
  }, [applyAuthenticatedUser, applyRecoveryState, supabase]);

  useEffect(() => {
    setStateOwnerId(userId);
    setEntries([]);
    setEntriesLoading(Boolean(userId));
    setEntriesError('');
    setEntriesReload(0);
    draftRef.current = '';
    draftRevision.current = 0;
    draftPersistence.current = { ...draftPersistence.current, content: '', ready: false, userId: '' };
    saveInFlight.current = false;
    saveOperationId.current += 1;
    setDraft('');
    setHydratedDraftScope('');
    setSaveState('idle');
    setSaveMessage('');
    setReminderState('default');
    setReminderMessage('');
    setPushBusy(false);
    reconcileSuspended.current = false;
    reconcileRequestedWhileSuspended.current = false;
  }, [userId]);

  useEffect(() => {
    if (!authReady || !userId || !todayKey || stateOwnerId !== userId) return;
    const requestedAccount: OperationScope = { epoch: accountEpoch.current, userId };
    let active = true;
    setEntriesLoading(true);
    setEntriesError('');

    if (isDemoMode) {
      setEntries(sortEntries(readDemoEntries()));
      setEntriesLoading(false);
      return () => { active = false; };
    }

    if (!supabase || !user) {
      setEntriesLoading(false);
      return () => { active = false; };
    }

    void (async () => {
      try {
        const loadedEntries: Entry[] = [];
        let reachedHistoryLimit = false;
        for (let page = 0; page < MAX_ENTRY_PAGES; page += 1) {
          const from = page * ENTRIES_PAGE_SIZE;
          const { data, error } = await supabase
            .from('entries')
            .select('id,user_id,entry_date,content,saved_timezone,created_at,updated_at')
            .order('entry_date', { ascending: false })
            .range(from, from + ENTRIES_PAGE_SIZE - 1);
          if (error) throw error;
          const pageEntries = (data ?? []) as Entry[];
          loadedEntries.push(...pageEntries);
          if (pageEntries.length < ENTRIES_PAGE_SIZE) break;
          reachedHistoryLimit = page === MAX_ENTRY_PAGES - 1;
        }
        if (!active || !isCurrentAccount(requestedAccount)) return;
        if (reachedHistoryLimit) {
          setEntriesError('Your history is larger than this app can safely load at once. Contact support before saving.');
        } else {
          setEntries(loadedEntries);
        }
        setEntriesLoading(false);
      } catch {
        if (!active || !isCurrentAccount(requestedAccount)) return;
        setEntriesError('Your entries could not be loaded. Check your connection before saving.');
        setEntriesLoading(false);
      }
    })();

    return () => { active = false; };
  }, [authReady, entriesReload, isCurrentAccount, stateOwnerId, supabase, todayKey, user, userId]);

  useEffect(() => {
    if (!userId || !todayKey || entriesLoading || entriesError || stateOwnerId !== userId) return;
    const hydrationKey = `${userId}:${todayKey}`;
    if (hydratedDraftScope === hydrationKey) return;

    const storedDraft = readDraft(userId, todayKey);
    const serverContent = todayEntry?.content ?? '';
    const restoreStoredDraft = shouldRestoreDraft(storedDraft, serverContent, todayEntry?.updated_at);
    const nextDraft = restoreStoredDraft && storedDraft ? storedDraft.content : serverContent;
    draftRef.current = nextDraft;
    draftRevision.current = 0;
    setDraft(nextDraft);
    if (restoreStoredDraft) {
      setSaveState('restored');
      setSaveMessage('A newer unsaved draft from this device was restored.');
    } else {
      if (storedDraft) clearDraft(userId, todayKey);
      setSaveState(todayEntry ? 'saved' : 'idle');
      setSaveMessage(todayEntry ? 'Saved for today.' : '');
    }
    setHydratedDraftScope(hydrationKey);
  }, [entriesError, entriesLoading, hydratedDraftScope, stateOwnerId, todayEntry, todayKey, userId]);

  const persistCurrentDraft = useCallback((): boolean => {
    const context = draftPersistence.current;
    if (
      !context.ready ||
      !context.userId ||
      !context.date ||
      context.content === context.serverContent
    ) {
      return true;
    }

    const stored = writeDraft(context.userId, context.date, context.timezone, context.content);
    if (!stored && currentUserId.current === context.userId) {
      if (saveInFlight.current) {
        setSaveMessage('Saving… New edits could not be protected locally, so keep the app open until saving finishes.');
      } else {
        setSaveState('error');
        setSaveMessage('This browser could not store your draft. Keep the app open and copy your text before leaving.');
      }
    }
    return stored;
  }, []);

  useEffect(() => {
    if (!draftReady || entriesLoading || draft === (todayEntry?.content ?? '')) return;
    const timer = window.setTimeout(() => {
      persistCurrentDraft();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, draftReady, entriesLoading, persistCurrentDraft, timezone, todayEntry, todayKey, userId]);

  useEffect(() => {
    const handlePageHide = () => { persistCurrentDraft(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistCurrentDraft();
    };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [persistCurrentDraft]);

  const reconcileSubscription = useCallback(() => {
    if (reconcileSuspended.current) {
      reconcileRequestedWhileSuspended.current = true;
      return;
    }
    const input = reconcileInput.current;
    reconcileRunner.current?.enqueue(input, async (queuedInput) => {
      const inputIsCurrent = () => isSameReconcileScope(queuedInput, {
        epoch: accountEpoch.current,
        timezone: timezoneRef.current,
        userId: currentUserId.current,
      });
      const updateReminder = (state: ReminderState, message = '') => {
        if (!inputIsCurrent()) return;
        setReminderState(state);
        setReminderMessage(message);
      };

      if (!queuedInput.userId) return;
      try {
        if (!supportsWebPush()) {
          updateReminder('unsupported');
          return;
        }
        if (isAppleMobile() && !isStandalone()) {
          updateReminder('needs-install');
          return;
        }
        if (Notification.permission === 'denied') {
          updateReminder('denied');
          return;
        }

        const registration = await registerServiceWorker();
        if (!inputIsCurrent()) return;
        const subscription = await registration?.pushManager.getSubscription();
        if (!inputIsCurrent()) return;
        if (!subscription) {
          updateReminder('default');
          return;
        }

        if (isDemoMode || !queuedInput.supabase || !queuedInput.user) {
          updateReminder('needs-sync', 'Connect Supabase to sync this reminder with the daily schedule.');
          return;
        }

        const serialized = serializeSubscription(subscription);
        if (!serialized) {
          updateReminder('error', 'This browser subscription could not be read. Turn reminders off and try again.');
          return;
        }

        const { error } = await queuedInput.supabase.functions.invoke('push-subscription', {
          body: {
            action: 'upsert',
            installationId: getInstallationId(),
            timezone: queuedInput.timezone,
            subscription: serialized,
          },
        });
        if (!inputIsCurrent()) return;
        if (error) {
          updateReminder('needs-sync', 'Reminder setup needs an internet connection. We will retry when the app opens.');
        } else {
          updateReminder('enabled', 'This device is set for a daily reminder at 19:45.');
        }
      } catch {
        updateReminder('needs-sync', 'Reminder status could not be refreshed. We will retry when the app opens.');
      }
    });
  }, []);

  const resumeReconciliation = useCallback((scope: OperationScope) => {
    if (!isCurrentAccount(scope)) return;
    reconcileSuspended.current = false;
    if (reconcileRequestedWhileSuspended.current) {
      reconcileRequestedWhileSuspended.current = false;
      reconcileSubscription();
    }
  }, [isCurrentAccount, reconcileSubscription]);

  useEffect(() => {
    if (!authReady || !userId) return;
    reconcileSubscription();

    const scheduleReconcile = () => {
      if (document.visibilityState !== 'visible') return;
      if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
      reconcileTimer.current = window.setTimeout(reconcileSubscription, 600);
    };
    window.addEventListener('pageshow', scheduleReconcile);
    document.addEventListener('visibilitychange', scheduleReconcile);
    return () => {
      window.removeEventListener('pageshow', scheduleReconcile);
      document.removeEventListener('visibilitychange', scheduleReconcile);
      if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
    };
  }, [authReady, reconcileSubscription, timezone, userId]);

  function navigate(nextView: AppView) {
    shouldFocusView.current = true;
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    window.history.pushState({}, '', url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveEntry() {
    if (saveInFlight.current || !draftReady) return;

    const requestedAccount: OperationScope = { epoch: accountEpoch.current, userId };
    const requestedDate = todayKey;
    const requestedTimezone = timezone;
    const draftSnapshot = draftRef.current;
    const revisionSnapshot = draftRevision.current;
    const content = draftSnapshot.trim();
    if (!content) {
      setSaveState('error');
      setSaveMessage('Write something before saving your note.');
      return;
    }
    if (!online) {
      const stored = writeDraft(userId, requestedDate, requestedTimezone, draftSnapshot);
      setSaveState(stored ? 'offline' : 'error');
      setSaveMessage(stored
        ? 'You are offline. This draft is kept on this device until you save again.'
        : 'You are offline and this browser could not store your draft. Keep the app open and copy your text before leaving.');
      return;
    }

    saveInFlight.current = true;
    const operationId = saveOperationId.current + 1;
    saveOperationId.current = operationId;
    const submittedDraftStored = writeDraft(userId, requestedDate, requestedTimezone, draftSnapshot);
    setSaveState('saving');
    setSaveMessage('Saving…');

    try {
      if (isDemoMode) {
        const now = new Date().toISOString();
        const row: Entry = {
          id: todayEntry?.id ?? crypto.randomUUID(),
          user_id: DEMO_USER_ID,
          entry_date: requestedDate,
          content,
          saved_timezone: requestedTimezone,
          created_at: todayEntry?.created_at ?? now,
          updated_at: now,
        };
        const nextEntries = sortEntries([row, ...entries.filter((entry) => entry.entry_date !== requestedDate)]);
        const persisted = writeDemoEntries(nextEntries);
        if (!isCurrentAccount(requestedAccount) || todayKeyRef.current !== requestedDate) return;
        setEntries(nextEntries);
        if (persisted) {
          clearDraft(userId, requestedDate);
          draftRef.current = content;
          draftPersistence.current = {
            ...draftPersistence.current,
            content,
            serverContent: content,
          };
          setDraft(content);
          setSaveState('saved');
          setSaveMessage('Saved on this device in preview mode.');
        } else {
          const draftStored = writeDraft(userId, requestedDate, requestedTimezone, draftRef.current);
          setSaveState('error');
          setSaveMessage(draftStored
            ? 'Preview storage failed, but your text remains in the separate local draft.'
            : 'This browser could not store your note or draft. Keep the app open and copy your text before leaving.');
        }
        return;
      }

      if (!supabase || !user) {
        if (isCurrentAccount(requestedAccount)) {
          setSaveState('error');
          setSaveMessage('Your session changed before the note could be saved. Please sign in again.');
        }
        return;
      }

      let data: unknown;
      let requestError: { message: string } | null = null;
      try {
        const response = await supabase.rpc('save_daily_entry', {
          p_content: content,
          p_timezone: requestedTimezone,
        });
        data = response.data;
        requestError = response.error;
      } catch {
        requestError = { message: 'network request failed' };
      }

      if (!isCurrentAccount(requestedAccount)) return;
      const sameDraftScope = todayKeyRef.current === requestedDate && draftPersistence.current.ready;

      if (requestError) {
        const draftStored = sameDraftScope
          ? writeDraft(userId, requestedDate, requestedTimezone, draftRef.current)
          : Boolean(readDraft(userId, requestedDate)) || submittedDraftStored;
        if (!sameDraftScope) return;
        const networkError = requestError.message.toLowerCase().includes('network') || !navigator.onLine;
        setSaveState(draftStored && networkError ? 'offline' : 'error');
        setSaveMessage(draftStored
          ? 'The note was not stored yet. Your draft is still on this device.'
          : 'The note was not stored, and this browser could not protect the draft locally. Keep the app open and copy your text before leaving.');
        return;
      }

      const result = (Array.isArray(data) ? data[0] : data) as Entry | undefined;
      if (!result) {
        const draftStored = sameDraftScope
          ? writeDraft(userId, requestedDate, requestedTimezone, draftRef.current)
          : Boolean(readDraft(userId, requestedDate)) || submittedDraftStored;
        if (!sameDraftScope) return;
        setSaveState('error');
        setSaveMessage(draftStored
          ? 'The note was not stored. Your draft remains on this device; please try again.'
          : 'The note was not stored, and this browser could not protect the draft locally. Keep the app open and copy your text before leaving.');
        return;
      }

      setEntries((current) => sortEntries([result, ...current.filter((entry) => entry.entry_date !== result.entry_date)]));
      if (!sameDraftScope) {
        const storedDraft = readDraft(userId, requestedDate);
        if (!shouldRestoreDraft(storedDraft, result.content, result.updated_at)) clearDraft(userId, requestedDate);
        return;
      }

      const hasNewerEdits = hasNewerDraftEdits(
        { content: draftSnapshot, revision: revisionSnapshot },
        { content: draftRef.current, revision: draftRevision.current },
      );
      if (hasNewerEdits) {
        const newerDraftStored = writeDraft(userId, requestedDate, requestedTimezone, draftRef.current);
        setSaveState(newerDraftStored ? 'restored' : 'error');
        setSaveMessage(newerDraftStored
          ? 'The submitted version was saved. Your newer changes remain as an unsaved draft.'
          : 'The submitted version was saved, but your newer changes could not be protected locally. Save again before leaving.');
        return;
      }

      clearDraft(userId, requestedDate);
      draftRef.current = result.content;
      draftPersistence.current = {
        ...draftPersistence.current,
        content: result.content,
        serverContent: result.content,
      };
      setDraft(result.content);
      setSaveState('saved');
      setSaveMessage('Saved for today.');
    } finally {
      if (saveOperationId.current === operationId) saveInFlight.current = false;
    }
  }

  async function enableReminder() {
    if (!supportsWebPush()) {
      setReminderState('unsupported');
      return;
    }
    if (isAppleMobile() && !isStandalone()) {
      setReminderState('needs-install');
      return;
    }
    if (!isPushConfigured) {
      setReminderState('error');
      setReminderMessage('The notification service still needs its public key.');
      return;
    }

    reconcileSuspended.current = true;
    setPushBusy(true);
    setReminderState('registering');
    setReminderMessage('');
    const requestedAccount: OperationScope = { epoch: accountEpoch.current, userId };
    const requestedTimezone = timezone;

    try {
      const permissionPromise = Notification.requestPermission();
      const permission = await permissionPromise;
      if (!isCurrentAccount(requestedAccount)) return;
      if (permission !== 'granted') {
        setReminderState(permission === 'denied' ? 'denied' : 'default');
        return;
      }

      await reconcileRunner.current?.whenIdle();
      if (!isCurrentAccount(requestedAccount)) return;
      const registration = await registerServiceWorker();
      if (!registration) throw new Error('Service worker unavailable');
      let subscription = await registration.pushManager.getSubscription();
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicConfig.vapidPublicKey),
      });
      if (!isCurrentAccount(requestedAccount) || timezoneRef.current !== requestedTimezone) {
        reconcileSubscription();
        return;
      }

      const serialized = serializeSubscription(subscription);
      if (!serialized || !supabase || !user) throw new Error('Subscription unavailable');
      const { error } = await supabase.functions.invoke('push-subscription', {
        body: { action: 'upsert', installationId: getInstallationId(), timezone: requestedTimezone, subscription: serialized },
      });
      if (!isCurrentAccount(requestedAccount) || timezoneRef.current !== requestedTimezone) {
        reconcileSubscription();
        return;
      }
      if (error) throw error;

      setReminderState('enabled');
      setReminderMessage('This device is set for a daily reminder at 19:45.');
    } catch {
      if (!isCurrentAccount(requestedAccount)) return;
      setReminderState('needs-sync');
      setReminderMessage('Reminder setup is incomplete. Check your connection and try again.');
    } finally {
      if (isCurrentAccount(requestedAccount)) {
        setPushBusy(false);
        resumeReconciliation(requestedAccount);
      }
    }
  }

  async function disableReminder() {
    const requestedAccount: OperationScope = { epoch: accountEpoch.current, userId };
    reconcileSuspended.current = true;
    setPushBusy(true);
    try {
      await reconcileRunner.current?.whenIdle();
      if (!isCurrentAccount(requestedAccount)) return;
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (!isCurrentAccount(requestedAccount)) return;
      const serialized = subscription ? serializeSubscription(subscription) : null;

      if (serialized && supabase && user) {
        const { error } = await supabase.functions.invoke('push-subscription', {
          body: { action: 'disable', installationId: getInstallationId(), endpoint: serialized.endpoint },
        });
        if (error) throw error;
      }
      if (!isCurrentAccount(requestedAccount)) return;
      await subscription?.unsubscribe();
      if (!isCurrentAccount(requestedAccount)) return;
      setReminderState('default');
      setReminderMessage('Reminders are off on this device.');
    } catch {
      if (!isCurrentAccount(requestedAccount)) return;
      setReminderState('error');
      setReminderMessage('The reminder could not be disabled. Please try again online.');
    } finally {
      if (isCurrentAccount(requestedAccount)) {
        setPushBusy(false);
        resumeReconciliation(requestedAccount);
      }
    }
  }

  async function sendTestPush() {
    const requestedAccount: OperationScope = { epoch: accountEpoch.current, userId };
    reconcileSuspended.current = true;
    setPushBusy(true);
    setReminderMessage('Sending a test…');
    try {
      if (Notification.permission !== 'granted') {
        setReminderState(Notification.permission === 'denied' ? 'denied' : 'default');
        setReminderMessage('Allow notifications on this device before sending a test.');
        return;
      }

      await reconcileRunner.current?.whenIdle();
      if (!isCurrentAccount(requestedAccount)) return;
      const registration = await registerServiceWorker();
      if (!registration) throw new Error('Service worker unavailable');
      let subscription = await registration.pushManager.getSubscription();
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicConfig.vapidPublicKey),
      });
      if (!isCurrentAccount(requestedAccount)) return;
      const serialized = serializeSubscription(subscription);
      if (!serialized || !supabase || !user) throw new Error('No active subscription');

      const installationId = getInstallationId();
      const { error: syncError } = await supabase.functions.invoke('push-subscription', {
        body: {
          action: 'upsert',
          installationId,
          timezone: timezoneRef.current,
          subscription: serialized,
        },
      });
      if (!isCurrentAccount(requestedAccount)) return;
      if (syncError) {
        const message = await pushFunctionErrorMessage(syncError, 'sync');
        if (!isCurrentAccount(requestedAccount)) return;
        setReminderState('needs-sync');
        setReminderMessage(message);
        return;
      }

      setReminderState('enabled');
      const { error: testError } = await supabase.functions.invoke('test-push', {
        body: { installationId, endpoint: serialized.endpoint },
      });
      if (!isCurrentAccount(requestedAccount)) return;
      if (testError) {
        const message = await pushFunctionErrorMessage(testError, 'test');
        if (!isCurrentAccount(requestedAccount)) return;
        setReminderMessage(message);
        return;
      }
      setReminderMessage('Test sent. It may take a moment to appear.');
    } catch {
      if (!isCurrentAccount(requestedAccount)) return;
      setReminderState('needs-sync');
      setReminderMessage('This device’s notification subscription could not be refreshed. Turn reminders off and on again.');
    } finally {
      if (isCurrentAccount(requestedAccount)) {
        setPushBusy(false);
        resumeReconciliation(requestedAccount);
      }
    }
  }

  async function changePassword(currentPassword: string, nextPassword: string): Promise<string> {
    if (!supabase || !user) return 'Sign in again before changing your password.';
    try {
      const { error } = await changeAccountPassword(supabase, currentPassword, nextPassword);
      return error ? passwordUpdateErrorMessage(error) : '';
    } catch (caughtError) {
      return passwordUpdateErrorMessage(caughtError);
    }
  }

  function finishPasswordRecovery(nextUser: User) {
    applyAuthenticatedUser(nextUser);
    setAuthScreenMode('sign-in');
    clearAuthCallbackUrl();
    applyRecoveryState('none');
    setAuthReady(true);
  }

  function requestNewRecovery() {
    clearAuthCallbackUrl();
    applyRecoveryState('none');
    if (user) navigate('settings');
    else setAuthScreenMode('forgot');
  }

  async function signOut() {
    if (!supabase || !user) return;
    const requestedAccount: OperationScope = { epoch: accountEpoch.current, userId };
    const signedOutUserId = userId;
    reconcileSuspended.current = true;
    setPushBusy(true);
    let signOutSucceeded = false;
    try {
      await reconcileRunner.current?.whenIdle();
      if (!isCurrentAccount(requestedAccount)) return;
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (!isCurrentAccount(requestedAccount)) return;
      const serialized = subscription ? serializeSubscription(subscription) : null;
      if (serialized) {
        const { error } = await supabase.functions.invoke('push-subscription', {
          body: { action: 'disable', installationId: getInstallationId(), endpoint: serialized.endpoint },
        });
        if (error) throw error;
        await subscription?.unsubscribe();
      }
      if (!isCurrentAccount(requestedAccount)) return;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      draftPersistence.current = { ...draftPersistence.current, content: '', ready: false, userId: '' };
      draftRef.current = '';
      clearUserDrafts(signedOutUserId);
      setAuthScreenMode('sign-in');
      signOutSucceeded = true;
      reconcileRequestedWhileSuspended.current = false;
    } catch {
      if (!isCurrentAccount(requestedAccount)) return;
      setReminderState('error');
      setReminderMessage('Reconnect before signing out so this device can be disabled safely.');
    } finally {
      if (isCurrentAccount(requestedAccount)) {
        setPushBusy(false);
        if (!signOutSucceeded) resumeReconciliation(requestedAccount);
      }
    }
  }

  if (!isDemoMode && supabase && recoveryState !== 'none') {
    return (
      <PasswordRecoveryScreen
        client={supabase}
        state={recoveryState}
        onComplete={finishPasswordRecovery}
        onRequestNew={requestNewRecovery}
      />
    );
  }

  if (!authReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4efe7] text-[#1d3930]">
        <div className="text-center"><span className="inline-block animate-spin text-2xl" aria-hidden="true">↻</span><p className="mt-3 text-sm">Opening your evening note…</p></div>
      </main>
    );
  }

  if (!isDemoMode && !isSupabaseConfigured) return <SetupRequired />;
  if (!isDemoMode && !user && supabase) {
    return <AuthScreen key={authScreenMode} client={supabase} initialMode={authScreenMode} />;
  }
  if (stateOwnerId !== userId) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4efe7] text-[#1d3930]">
        <div className="text-center"><span className="inline-block animate-spin text-2xl" aria-hidden="true">↻</span><p className="mt-3 text-sm">Opening your private note…</p></div>
      </main>
    );
  }

  const saveStatusIcon =
    saveState === 'saving' ? <span className="inline-block animate-spin" aria-hidden="true">↻</span>
      : saveState === 'offline' ? <span aria-hidden="true">⌁</span>
        : saveState === 'saved' ? <span aria-hidden="true">✓</span> : null;

  return (
    <main className="min-h-screen bg-[#f4efe7] text-[#18201d]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-32 pt-[max(1.75rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-4">
          <button type="button" onClick={() => navigate('today')} className="flex min-h-12 items-center gap-3 rounded-xl text-left" aria-label="Open today's note">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1d3930] text-lg text-[#fffaf0] shadow-[0_8px_24px_rgba(29,57,48,0.16)]">✦</span>
            <span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5d6963]">Evening Note</span>
              <span className="mt-0.5 block text-sm text-[#5d6963]">
                {view === 'today' ? formatLongDate(timezone) : view === 'history' ? 'Your daily notes' : 'Your preferences'}
              </span>
            </span>
          </button>
          <button type="button" onClick={() => navigate('settings')} className="flex min-h-11 items-center gap-2 rounded-full border border-[#cec7bc] bg-white/60 px-3 text-xs font-semibold" aria-label="Open reminder settings">
            <span className={`h-2 w-2 rounded-full ${reminderState === 'enabled' ? 'bg-[#4f7c63]' : 'bg-[#d86f4d]'}`} />
            {REMINDER_TIME}
          </button>
        </header>

        {isDemoMode && (
          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-[#dfc6ab] bg-[#fff6e8] px-4 py-3 text-xs leading-5 text-[#765638]">
            <span className="mt-0.5 shrink-0 text-base" aria-hidden="true">✦</span>
            Preview mode stores notes only on this device. Connect Supabase for private accounts and reminders.
          </div>
        )}

        {entriesError && view === 'today' && (
          <div className="mt-5 rounded-2xl border border-[#e0b9a9] bg-[#fff1eb] px-4 py-3 text-xs leading-5 text-[#8a4632]" role="alert">
            <p>{entriesError}</p>
            <button type="button" onClick={() => setEntriesReload((value) => value + 1)} className="mt-2 min-h-9 rounded-lg font-semibold underline underline-offset-4">Try loading again</button>
          </div>
        )}

        {view === 'today' && (
          <section className="flex flex-1 flex-col justify-center py-10">
            <p className="mb-3 text-sm font-medium text-[#5d6963]">Today</p>
            <h1 id="view-heading" tabIndex={-1} className="max-w-sm font-serif text-[2.55rem] leading-[1.04] tracking-[-0.035em]">What would you like to remember?</h1>
            <p className="mt-4 max-w-sm text-[15px] leading-6 text-[#5d6963]">A quiet place for one thought from your day.</p>

            <label htmlFor="daily-entry" className="sr-only">Today&apos;s entry</label>
            <textarea
              id="daily-entry"
              name="daily-entry"
              value={draft}
              onChange={(event) => {
                const nextDraft = event.target.value;
                draftRef.current = nextDraft;
                draftPersistence.current = { ...draftPersistence.current, content: nextDraft };
                draftRevision.current += 1;
                setDraft(nextDraft);
                if (!saveInFlight.current) {
                  setSaveState('idle');
                  setSaveMessage('');
                }
              }}
              disabled={!draftReady || entriesLoading || Boolean(entriesError)}
              maxLength={10_000}
              placeholder="Write what’s on your mind…"
              className="mt-8 min-h-52 w-full resize-none rounded-[1.75rem] border border-[#d7d0c4] bg-[#fffdf8] p-5 text-base leading-7 shadow-[0_18px_60px_rgba(50,57,50,0.08)] outline-none transition placeholder:text-[#6b756f] focus:border-[#65786f] focus:ring-4 focus:ring-[#65786f]/10"
            />

            <div className="min-h-10 px-1 pt-3" aria-live="polite">
              {saveMessage && (
                <p className={`flex items-start gap-2 text-xs leading-5 ${saveState === 'error' ? 'text-[#a4432b]' : 'text-[#627069]'}`}>
                  {saveStatusIcon}{saveMessage}
                </p>
              )}
            </div>

            <button type="button" onClick={() => void saveEntry()} disabled={!draftReady || saveState === 'saving' || entriesLoading || Boolean(entriesError)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#1d3930] px-5 text-base font-semibold text-[#fffdf8] shadow-[0_12px_30px_rgba(29,57,48,0.2)] transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-65">
              {saveState === 'saving' ? <span className="inline-block animate-spin text-lg" aria-hidden="true">↻</span> : <span className="text-lg" aria-hidden="true">✎</span>}
              {todayEntry ? 'Update today’s note' : 'Save today’s note'}
            </button>
          </section>
        )}

        {view === 'history' && (
          <section className="py-10">
            <p className="text-sm font-medium text-[#5d6963]">History</p>
            <h1 id="view-heading" tabIndex={-1} className="mt-3 font-serif text-[2.45rem] leading-[1.05] tracking-[-0.035em]">The days you kept.</h1>
            <p className="mt-4 text-[15px] leading-6 text-[#5d6963]">Past notes are read-only, just as you left them.</p>

            {entriesError ? (
              <div className="mt-10 rounded-[1.6rem] border border-[#e0b9a9] bg-[#fff1eb] p-6 text-center text-[#7d4434]" role="alert">
                <p className="text-sm leading-6">{entriesError}</p>
                <button type="button" onClick={() => setEntriesReload((value) => value + 1)} className="mt-4 min-h-11 rounded-xl bg-[#1d3930] px-5 text-sm font-semibold text-white">Try again</button>
              </div>
            ) : entriesLoading ? (
              <div className="mt-12 flex items-center justify-center gap-2 text-sm text-[#5d6963]"><span className="inline-block animate-spin text-lg" aria-hidden="true">↻</span>Loading your notes…</div>
            ) : entries.length === 0 ? (
              <div className="mt-10 rounded-[1.6rem] border border-dashed border-[#cfc7ba] bg-white/45 p-7 text-center">
                <span className="mx-auto block text-2xl text-[#5d6963]" aria-hidden="true">◷</span>
                <h2 className="mt-4 font-serif text-2xl">Your first note is waiting.</h2>
                <p className="mt-2 text-sm leading-6 text-[#5d6963]">Write today’s thought and it will appear here.</p>
                <button type="button" onClick={() => navigate('today')} className="mt-5 min-h-11 rounded-xl bg-[#1d3930] px-5 text-sm font-semibold text-white">Write today’s note</button>
              </div>
            ) : (
              <ol className="mt-8 space-y-4">
                {entries.map((entry) => (
                  <li key={entry.id} className="rounded-[1.6rem] border border-[#d8d0c4] bg-[#fffdf8] p-5 shadow-[0_12px_35px_rgba(50,57,50,0.05)]">
                    <time className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5d6963]" dateTime={entry.entry_date}>
                      {entry.entry_date === todayKey ? 'Today' : formatEntryDate(entry.entry_date)}
                    </time>
                    <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-[#2d3833]">{entry.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {view === 'settings' && (
          <SettingsView
            timezone={timezone}
            reminderState={reminderState}
            reminderMessage={reminderMessage}
            pushBusy={pushBusy}
            onEnable={() => void enableReminder()}
            onDisable={() => void disableReminder()}
            onTest={() => void sendTestPush()}
            onChangePassword={changePassword}
            onSignOut={() => void signOut()}
            demoMode={isDemoMode}
            signedInEmail={user?.email ?? ''}
          />
        )}

        <BottomNav view={view} onNavigate={navigate} />
      </div>
    </main>
  );
}

type SettingsViewProps = {
  timezone: string;
  reminderState: ReminderState;
  reminderMessage: string;
  pushBusy: boolean;
  demoMode: boolean;
  signedInEmail: string;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
  onChangePassword: (currentPassword: string, nextPassword: string) => Promise<string>;
  onSignOut: () => void;
};

function SettingsView({ timezone, reminderState, reminderMessage, pushBusy, demoMode, signedInEmail, onEnable, onDisable, onTest, onChangePassword, onSignOut }: SettingsViewProps) {
  const installed = isStandalone();
  const appleMobile = isAppleMobile();
  const enabled = reminderState === 'enabled';
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const stateCopy: Record<ReminderState, string> = {
    unsupported: 'Web Push is not available in this browser.',
    'needs-install': 'Open Evening Note from your Home Screen to enable iPhone reminders.',
    default: 'Reminders are off on this device.',
    registering: 'Connecting this device…',
    enabled: 'Daily reminder enabled.',
    'needs-sync': 'This device needs to finish syncing its reminder.',
    denied: 'Notifications are blocked. Allow them in iPhone Settings to continue.',
    error: 'Reminder setup needs attention.',
  };

  async function submitPasswordChange() {
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    const validationError = passwordValidationMessage(nextPassword, passwordConfirmation);
    if (validationError) {
      setPasswordError(validationError);
      return;
    }

    setPasswordBusy(true);
    setPasswordError('');
    setPasswordMessage('');
    const updateError = await onChangePassword(currentPassword, nextPassword);
    if (updateError) {
      setPasswordError(updateError);
    } else {
      setCurrentPassword('');
      setNextPassword('');
      setPasswordConfirmation('');
      setShowPasswords(false);
      setPasswordMessage('Your password has been updated.');
    }
    setPasswordBusy(false);
  }

  return (
    <section className="py-10">
      <p className="text-sm font-medium text-[#5d6963]">Settings</p>
      <h1 id="view-heading" tabIndex={-1} className="mt-3 font-serif text-[2.45rem] leading-[1.05] tracking-[-0.035em]">A gentle nudge, right on time.</h1>
      <p className="mt-4 text-[15px] leading-6 text-[#5d6963]">Your reminder follows this device’s timezone and adjusts when you travel.</p>

      <div className="mt-8 rounded-[1.7rem] border border-[#d5cdc1] bg-[#fffdf8] p-5 shadow-[0_15px_45px_rgba(50,57,50,0.06)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#e9e5d9] text-xl text-[#1d3930]" aria-hidden="true">◷</span>
            <div><p className="text-sm font-semibold">Daily reminder</p><p className="mt-1 font-serif text-3xl text-[#1d3930]">{REMINDER_TIME}</p><p className="mt-1 max-w-52 break-words text-xs leading-5 text-[#5d6963]">{timezone}</p></div>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${enabled ? 'bg-[#dfeadf] text-[#315a42]' : 'bg-[#eee9df] text-[#5d6963]'}`}>{enabled ? 'On' : 'Off'}</span>
        </div>

        <div className="mt-5 rounded-2xl bg-[#f2eee6] px-4 py-3 text-xs leading-5 text-[#626d67]" aria-live="polite">
          <span className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0" aria-hidden="true">{enabled ? '●' : '○'}</span>
            {reminderMessage || stateCopy[reminderState]}
          </span>
        </div>

        {!demoMode && reminderState !== 'denied' && reminderState !== 'unsupported' && (
          <div className="mt-4 grid gap-3">
            {enabled ? (
              <>
                <button type="button" onClick={onTest} disabled={pushBusy} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1d3930] px-4 text-sm font-semibold text-white disabled:opacity-60">
                  {pushBusy ? <span className="inline-block animate-spin" aria-hidden="true">↻</span> : <span aria-hidden="true">↗</span>}Send a test notification
                </button>
                <button type="button" onClick={onDisable} disabled={pushBusy} className="min-h-12 rounded-xl border border-[#d0c7ba] px-4 text-sm font-semibold text-[#7a4d40] disabled:opacity-60">Turn off on this device</button>
              </>
            ) : (
              <button type="button" onClick={onEnable} disabled={pushBusy || reminderState === 'needs-install'} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1d3930] px-4 text-sm font-semibold text-white disabled:opacity-55">
                {pushBusy ? <span className="inline-block animate-spin" aria-hidden="true">↻</span> : <span aria-hidden="true">●</span>}Enable daily reminder
              </button>
            )}
          </div>
        )}
      </div>

      {appleMobile && !installed && (
        <div className="mt-5 rounded-[1.7rem] border border-[#dfc6ab] bg-[#fff6e8] p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f0dfca] text-xl text-[#865735]" aria-hidden="true">⇩</span>
            <div><h2 className="font-semibold">Add to your Home Screen</h2><p className="mt-1 text-xs text-[#78644e]">Required for notifications on iPhone.</p></div>
          </div>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-[#684f39]">
            <li className="flex gap-3"><span className="font-semibold">1.</span><span>Open this page in Safari.</span></li>
            <li className="flex gap-3"><span className="font-semibold">2.</span><span>Tap <span className="mx-1" aria-label="Share">⇧</span>, then choose “Add to Home Screen.”</span></li>
            <li className="flex gap-3"><span className="font-semibold">3.</span><span>Open Evening Note from the new Home Screen icon.</span></li>
          </ol>
        </div>
      )}

      <div className="mt-5 rounded-[1.7rem] border border-[#d5cdc1] bg-white/55 p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e9e5d9] text-xl text-[#1d3930]" aria-hidden="true">▯</span>
          <div><p className="text-sm font-semibold">This app</p><p className="mt-1 text-xs leading-5 text-[#5d6963]">{installed ? 'Running from your Home Screen.' : 'Running in a browser tab.'}</p></div>
        </div>
      </div>

      {!demoMode && (
        <>
          <div className="mt-5 rounded-[1.7rem] border border-[#d5cdc1] bg-[#fffdf8] p-5 shadow-[0_15px_45px_rgba(50,57,50,0.05)]">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e9e5d9] text-xl text-[#1d3930]" aria-hidden="true">◇</span>
              <div><h2 className="text-sm font-semibold">Account password</h2><p className="mt-1 text-xs leading-5 text-[#5d6963]">Signed in as {signedInEmail}</p></div>
            </div>

            <form
              className="mt-5 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitPasswordChange();
              }}
            >
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#45524c]">Current password</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-[#d4ccbf] bg-white px-4 text-base outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
                  disabled={passwordBusy}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#45524c]">New password</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  value={nextPassword}
                  onChange={(event) => setNextPassword(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-[#d4ccbf] bg-white px-4 text-base outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
                  disabled={passwordBusy}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#45524c]">Confirm new password</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  className="min-h-12 w-full rounded-xl border border-[#d4ccbf] bg-white px-4 text-base outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
                  disabled={passwordBusy}
                  required
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[#68736d]">At least {PASSWORD_MIN_LENGTH} characters.</p>
                <button type="button" onClick={() => setShowPasswords((value) => !value)} className="min-h-10 rounded-xl px-3 text-xs font-semibold text-[#52625a]">
                  {showPasswords ? 'Hide passwords' : 'Show passwords'}
                </button>
              </div>

              <div className="min-h-9 text-xs leading-5" aria-live="polite">
                {passwordError && <p className="text-[#a4432b]">{passwordError}</p>}
                {!passwordError && passwordMessage && <p className="text-[#52655b]">{passwordMessage}</p>}
              </div>

              <button type="submit" disabled={passwordBusy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1d3930] px-4 text-sm font-semibold text-white disabled:opacity-60">
                {passwordBusy && <span className="inline-block animate-spin" aria-hidden="true">↻</span>}
                Update password
              </button>
            </form>
          </div>

          <div className="mt-8 border-t border-[#d6cec2] pt-6">
            <button type="button" onClick={onSignOut} disabled={pushBusy || passwordBusy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#d0c7ba] bg-white/40 px-4 text-sm font-semibold text-[#76493e] disabled:opacity-60"><span aria-hidden="true">↪</span>Sign out and disable this device</button>
          </div>
        </>
      )}
    </section>
  );
}

function BottomNav({ view, onNavigate }: { view: AppView; onNavigate: (view: AppView) => void }) {
  const items: Array<{ view: AppView; label: string; symbol: string }> = [
    { view: 'today', label: 'Today', symbol: '✎' },
    { view: 'history', label: 'History', symbol: '◷' },
    { view: 'settings', label: 'Settings', symbol: '⚙' },
  ];

  return (
    <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md justify-around border-t border-[#d9d1c5] bg-[#f8f4ed]/95 px-5 pb-[max(0.8rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
      {items.map((item) => {
        const active = view === item.view;
        return (
          <button key={item.view} type="button" onClick={() => onNavigate(item.view)} aria-current={active ? 'page' : undefined} className={`flex min-h-14 min-w-20 flex-col items-center justify-center gap-1 rounded-xl text-xs ${active ? 'font-semibold text-[#1d3930]' : 'font-medium text-[#5d6963]'}`}>
            <span className="text-lg leading-none" aria-hidden="true">{item.symbol}</span>{item.label}
          </button>
        );
      })}
    </nav>
  );
}

function SetupRequired() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4efe7] px-5 text-[#18201d]">
      <section className="w-full max-w-md rounded-[2rem] border border-[#d5cdc1] bg-[#fffdf8] p-7 shadow-[0_22px_70px_rgba(50,57,50,0.1)]">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#1d3930] text-xl text-white">✦</span>
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.2em] text-[#5d6963]">Evening Note</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight">The app is ready for its Supabase connection.</h1>
        <p className="mt-4 text-sm leading-6 text-[#5d6963]">Add the public Supabase project URL, publishable key, and VAPID public key to the hosted environment, then redeploy.</p>
        <div className="mt-6 flex items-start gap-3 rounded-2xl bg-[#f1ede5] p-4 text-sm leading-6 text-[#5d6963]"><span className="mt-0.5 text-lg" aria-hidden="true">↻</span>No private key or user data belongs in the browser configuration.</div>
      </section>
    </main>
  );
}
