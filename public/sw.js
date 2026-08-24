/* global self, clients */
const CACHE_PREFIX = 'evening-note';
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
// This key stores only the generic, unauthenticated React document. Entries are
// fetched client-side from Supabase and are never written to Cache Storage.
const SHELL_CACHE_KEY = '/__evening-note-shell';
const STATIC_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-512.png',
  '/apple-touch-icon.png',
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

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
        .catch(async () => (await caches.match(SHELL_CACHE_KEY)) ?? caches.match(OFFLINE_URL)),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
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

function notificationDetails(event) {
  const fallback = {
    title: 'Evening Note',
    body: 'Take a moment to write today’s entry.',
    navigate: `${self.location.origin}/?view=today`,
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

function sameOriginTarget(value) {
  const fallback = `${self.location.origin}/?view=today`;
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.href : fallback;
  } catch {
    return fallback;
  }
}

self.addEventListener('push', (event) => {
  const details = notificationDetails(event);
  const target = sameOriginTarget(details.navigate);
  event.waitUntil(
    self.registration.showNotification(details.title, {
      body: details.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: details.tag,
      renotify: false,
      data: { url: target },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = sameOriginTarget(event.notification.data?.url);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});
