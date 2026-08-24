export function buildNotificationPayload(origin: string, localDate: string, test = false) {
  const tag = test ? 'evening-note-test' : `evening-note-${localDate}`;
  return {
    web_push: 8030,
    notification: {
      title: 'Evening Note',
      body: test ? 'Your evening reminder is ready.' : 'Take a moment to write today’s entry.',
      navigate: `${origin}/?view=today`,
      icon: `${origin}/icon-192.png`,
      tag,
    },
  };
}
