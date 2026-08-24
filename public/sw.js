/* global self, clients */
const CACHE_PREFIX = 'evening-note';
// Deployment build wrappers replace the build marker and precache list in the
// generated copy. The source defaults keep direct development builds safe.
const CACHE_VERSION = 'v3-__EVENING_NOTE_BUILD__';
const GENERATED_ASSETS = /* __EVENING_NOTE_PRECACHE__ */ [];
const APP_SCOPE_URL = new URL(self.registration.scope);
const APP_SCOPE_PATH = APP_SCOPE_URL.pathname;
const scopedPath = (path) => new URL(path.replace(/^\/+/, ''), APP_SCOPE_URL).pathname;
const OFFLINE_URL = scopedPath('offline.html');
// This key stores only the generic, unauthenticated React document. Entries are
// fetched client-side from Supabase and are never written to Cache Storage.
const SHELL_CACHE_KEY = scopedPath('__evening-note-shell');
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  APP_SCOPE_PATH,
  OFFLINE_URL,
  scopedPath('manifest.webmanifest'),
  scopedPath('icon-192.png'),
  scopedPath('icon-512.png'),
  scopedPath('maskable-512.png'),
  scopedPath('apple-touch-icon.png'),
  ...GENERATED_ASSETS,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isAppUrl(url) {
  return url.origin === APP_SCOPE_URL.origin && url.pathname.startsWith(APP_SCOPE_PATH);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isAppUrl(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(STATIC_CACHE).then((cache) => cache.put(SHELL_CACHE_KEY, copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(SHELL_CACHE_KEY)) ??
          (await caches.match(APP_SCOPE_PATH)) ??
          caches.match(OFFLINE_URL)),
    );
    return;
  }

  const staticPath = scopedPath('_next/static/');
  const isStaticAsset =
    url.pathname.startsWith(staticPath) ||
    /\.(?:css|js|png|webmanifest|woff2?)$/.test(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

function todayUrl() {
  return new URL('?view=today', APP_SCOPE_URL).href;
}

function notificationDetails(event) {
  const fallback = {
    title: 'Evening Note',
    body: 'Take a moment to write today’s entry.',
    navigate: todayUrl(),
    tag: 'evening-note-daily',
  };

  if (!event.data) return fallback;
  try {
    const payload = event.data.json();
    const notification = payload?.notification ?? payload ?? {};
    return {
      title: typeof notification.title === 'string' ? notification.title : fallback.title,
      body: typeof notification.body === 'string' ? notification.body : fallback.body,
      navigate: typeof notification.navigate === 'string' ? notification.navigate : fallback.navigate,
      tag: typeof notification.tag === 'string' ? notification.tag : fallback.tag,
    };
  } catch {
    return fallback;
  }
}

function scopedTarget(value) {
  try {
    const url = new URL(value, APP_SCOPE_URL);
    return isAppUrl(url) ? url.href : todayUrl();
  } catch {
    return todayUrl();
  }
}

self.addEventListener('push', (event) => {
  const details = notificationDetails(event);
  const target = scopedTarget(details.navigate);
  const icon = scopedPath('icon-192.png');
  event.waitUntil(
    self.registration.showNotification(details.title, {
      body: details.body,
      icon,
      badge: icon,
      tag: details.tag,
      renotify: false,
      data: { url: target },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = scopedTarget(event.notification.data?.url);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (isAppUrl(new URL(client.url))) {
          await client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});
