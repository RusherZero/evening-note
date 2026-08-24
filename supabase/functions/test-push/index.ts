import { authenticatedUser, getAdminClient } from '../_shared/auth.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { pushStatus, sendPush, type StoredSubscription } from '../_shared/push.ts';
import { validPushEndpoint } from '../_shared/subscription-validation.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed' }, 405);

  const user = await authenticatedUser(request);
  if (!user) return jsonResponse(request, { error: 'Authentication required' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid JSON' }, 400);
  }

  if (
    typeof body.installationId !== 'string' || !UUID_PATTERN.test(body.installationId) ||
    !validPushEndpoint(body.endpoint)
  ) {
    return jsonResponse(request, { error: 'Invalid subscription' }, 400);
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc('_internal_claim_test_subscription', {
    p_user_id: user.id,
    p_installation_id: body.installationId,
    p_endpoint: body.endpoint,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error) {
    console.error('test-push subscription claim failed', { code: error.code || 'unknown' });
    return jsonResponse(request, { error: 'Test notification service is unavailable' }, 503);
  }
  if (!row) {
    return jsonResponse(request, { error: 'Wait one minute before sending another test' }, 429);
  }

  try {
    await sendPush(row as StoredSubscription, new Date().toISOString().slice(0, 10), 60, true);
    return jsonResponse(request, { accepted: true }, 202);
  } catch (pushError) {
    const status = pushStatus(pushError);
    console.warn('test-push provider request failed', { status: status ?? 'network' });
    if (status === 404 || status === 410) {
      const { data: disabled, error: disableError } = await admin.rpc('_internal_disable_push_subscription', {
        p_user_id: user.id,
        p_installation_id: body.installationId,
        p_endpoint: body.endpoint,
      });
      if (disableError || disabled !== true) {
        return jsonResponse(request, { error: 'Test notification state could not be updated' }, 503);
      }
    }
    return jsonResponse(request, { error: 'Test notification could not be delivered' }, 502);
  }
});
