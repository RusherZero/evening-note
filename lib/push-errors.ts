type FunctionErrorContext = {
  status?: unknown;
  clone?: () => unknown;
  json?: () => Promise<unknown>;
};

type FunctionErrorDetails = {
  serverMessage: string;
  status: number | null;
};

async function functionErrorDetails(error: unknown): Promise<FunctionErrorDetails> {
  if (typeof error !== 'object' || error === null || !('context' in error)) {
    return { serverMessage: '', status: null };
  }

  const context = (error as { context?: unknown }).context as FunctionErrorContext | undefined;
  if (!context || typeof context !== 'object') {
    return { serverMessage: '', status: null };
  }

  const status = typeof context.status === 'number' ? context.status : null;
  let response = context;
  try {
    const clone = typeof context.clone === 'function' ? context.clone() : null;
    if (clone && typeof clone === 'object') response = clone as FunctionErrorContext;
    const payload = typeof response.json === 'function' ? await response.json() : null;
    const serverMessage = typeof payload === 'object' && payload !== null && 'error' in payload
      && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : '';
    return { serverMessage, status };
  } catch {
    return { serverMessage: '', status };
  }
}

export async function pushFunctionErrorMessage(
  error: unknown,
  operation: 'sync' | 'test',
): Promise<string> {
  const details = await functionErrorDetails(error);

  if (details.status === 401 || details.serverMessage === 'Authentication required') {
    return 'Your sign-in has expired. Sign out, sign in again, and retry.';
  }
  if (details.status === 429 || details.serverMessage.includes('Wait one minute')) {
    return 'Please wait one minute before sending another test.';
  }
  if (details.status === 400 || details.serverMessage.includes('Invalid subscription')) {
    return 'This device’s notification subscription needs to be refreshed. Turn reminders off and on again.';
  }
  if (details.status === 502) {
    return 'The push service rejected this test. Turn reminders off and on again, then retry.';
  }
  if (details.status === 503) {
    return 'The notification service is temporarily unavailable. Please try again shortly.';
  }

  return operation === 'sync'
    ? 'This device could not sync its reminder. Turn reminders off and on again.'
    : 'The test could not reach the notification service. Please try again online.';
}

