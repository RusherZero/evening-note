import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const root = process.cwd();
const workerSource = readFileSync(join(root, 'public', 'sw.js'), 'utf8');

type WorkerHandler = (event: Record<string, unknown>) => void;

function loadWorker(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, WorkerHandler> = {};
  const showNotification = vi.fn(async () => undefined);
  const workerClients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => []),
    openWindow: vi.fn(async () => undefined),
  };
  const workerSelf = {
    location: { origin: 'https://notes.example' },
    registration: { showNotification },
    clients: workerClients,
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (name: string, handler: WorkerHandler) => { handlers[name] = handler; },
  };
  const defaultCache = {
    addAll: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
  };
  const caches = {
    open: vi.fn(async () => defaultCache),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => undefined),
  };

  runInNewContext(workerSource, {
    URL,
    Promise,
    console,
    self: workerSelf,
    clients: workerClients,
    caches,
    fetch: vi.fn(async () => { throw new Error('offline'); }),
    ...overrides,
  });

  return { handlers, showNotification, caches, workerClients };
}

function pngDimensions(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('installable PWA assets', () => {
  it('has a stable standalone manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'),
    );
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBeUndefined();
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true);
  });

  it('ships correctly sized raster install icons', () => {
    expect(pngDimensions(join(root, 'public', 'icon-192.png'))).toEqual([192, 192]);
    expect(pngDimensions(join(root, 'public', 'icon-512.png'))).toEqual([512, 512]);
    expect(pngDimensions(join(root, 'public', 'maskable-512.png'))).toEqual([512, 512]);
    expect(pngDimensions(join(root, 'public', 'apple-touch-icon.png'))).toEqual([180, 180]);
  });

  it('opens the cached generic shell on an offline navigation', async () => {
    const shell = { kind: 'cached-shell' };
    const caches = {
      open: vi.fn(async () => ({ put: vi.fn(async () => undefined) })),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
      match: vi.fn(async (key: string) => key === '/__evening-note-shell' ? shell : undefined),
    };
    const { handlers } = loadWorker({ caches });
    let response: Promise<unknown> | undefined;
    handlers.fetch({
      request: { method: 'GET', mode: 'navigate', url: 'https://notes.example/?view=today' },
      respondWith: (value: Promise<unknown>) => { response = value; },
    });

    await expect(response).resolves.toBe(shell);
    expect(caches.match).toHaveBeenCalledWith('/__evening-note-shell');
  });

  it('always displays a generic visible notification and rejects external navigation', async () => {
    const { handlers, showNotification } = loadWorker();
    let work: Promise<unknown> | undefined;
    handlers.push({
      data: {
        json: () => ({
          web_push: 8030,
          notification: {
            title: 'Evening Note',
            body: 'Take a moment to write today’s entry.',
            navigate: 'https://malicious.example/collect',
            tag: 'evening-note-2026-08-24',
          },
        }),
      },
      waitUntil: (value: Promise<unknown>) => { work = value; },
    });

    await work;
    expect(showNotification).toHaveBeenCalledWith(
      'Evening Note',
      expect.objectContaining({
        body: 'Take a moment to write today’s entry.',
        data: { url: 'https://notes.example/?view=today' },
      }),
    );
  });

  it('ships an interactive last-resort offline draft editor', () => {
    const offline = readFileSync(join(root, 'public', 'offline.html'), 'utf8');
    expect(offline).toContain('id="offline-draft"');
    expect(offline).toContain("const prefix = 'evening-note:draft:'");
    expect(offline).toContain('localStorage.setItem(selected.key');
    expect(offline).toContain('This device could not store the draft');
  });
});
