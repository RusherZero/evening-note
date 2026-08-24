function normalizedAppUrl(value: string): URL {
  const appUrl = new URL(value);
  appUrl.pathname = `${appUrl.pathname.replace(/\/+$/, '')}/`;
  appUrl.search = '';
  appUrl.hash = '';
  return appUrl;
}

export function buildNotificationPayload(appUrlValue: string, localDate: string, test = false) {
  const appUrl = normalizedAppUrl(appUrlValue);
  const tag = test ? 'evening-note-test' : `evening-note-${localDate}`;
  return {
    web_push: 8030,
    notification: {
      title: 'Evening Note',
      body: test ? 'Your evening reminder is ready.' : 'Take a moment to write today’s entry.',
      navigate: new URL('?view=today', appUrl).href,
      icon: new URL('icon-192.png', appUrl).href,
      tag,
    },
  };
}
