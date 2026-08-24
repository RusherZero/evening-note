import { describe, expect, it } from 'vitest';
import { buildNotificationPayload } from './push-payload';

describe('declarative Web Push payload', () => {
  it('contains generic copy, a stable daily tag, and same-app navigation', () => {
    const payload = buildNotificationPayload('https://notes.example', '2026-08-24');
    expect(payload).toEqual({
      web_push: 8030,
      notification: {
        title: 'Evening Note',
        body: 'Take a moment to write today’s entry.',
        navigate: 'https://notes.example/?view=today',
        icon: 'https://notes.example/icon-192.png',
        tag: 'evening-note-2026-08-24',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('private entry text');
  });

  it('uses a separate generic tag and copy for tests', () => {
    const payload = buildNotificationPayload('https://notes.example', '2026-08-24', true);
    expect(payload.notification.tag).toBe('evening-note-test');
    expect(payload.notification.body).toBe('Your evening reminder is ready.');
  });

  it('keeps project-site notification URLs inside the app base path', () => {
    const payload = buildNotificationPayload(
      'https://rusherzero.github.io/evening-note',
      '2026-08-24',
    );
    expect(payload.notification.navigate).toBe(
      'https://rusherzero.github.io/evening-note/?view=today',
    );
    expect(payload.notification.icon).toBe(
      'https://rusherzero.github.io/evening-note/icon-192.png',
    );
  });
});
