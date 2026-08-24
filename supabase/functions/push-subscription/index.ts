import { authenticatedUser, getAdminClient } from '../_shared/auth.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { validPushEndpoint, validPushKeys } from '../_shared/subscription-validation.ts';

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

  const action = body.action;
  const installationId = body.installationId;
  if (typeof installationId !== 'string' || !UUID_PATTERN.test(installationId)) {
    return jsonResponse(request, { error: 'Invalid installation' }, 400);
  }

  const admin = getAdminClient();

  if (action === 'disable') {
    if (!validPushEndpoint(body.endpoint)) return jsonResponse(request, { error: 'Invalid subscription' }, 400);
    const { data, error } = await admin.rpc('_internal_disable_push_subscription', {
      p_user_id: user.id,
      p_installation_id: installationId,
      p_endpoint: body.endpoint,
    });
    return error || data !== true
      ? jsonResponse(request, { error: 'Subscription could not be disabled' }, 400)
      : jsonResponse(request, { enabled: false });
  }

  if (action !== 'upsert') return jsonResponse(request, { error: 'Unknown action' }, 400);

  const timezone = body.timezone;
  const subscription = body.subscription as Record<string, unknown> | undefined;
  const keys = subscription?.keys as Record<string, unknown> | undefined;
  if (
    typeof timezone !== 'string' || timezone.length > 100 ||
    !subscription || !validPushEndpoint(subscription.endpoint) ||
    !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' ||
    !(await validPushKeys(keys.p256dh, keys.auth))
  ) {
    return jsonResponse(request, { error: 'Invalid subscription' }, 400);
  }

  const { data, error } = await admin.rpc('_internal_upsert_push_subscription', {
    p_user_id: user.id,
    p_installation_id: installationId,
    p_endpoint: subscription.endpoint,
    p_p256dh: keys.p256dh,
    p_auth_secret: keys.auth,
    p_timezone: timezone,
  });
  if (error || !Array.isArray(data) || data.length !== 1) {
    return jsonResponse(request, { error: 'Subscription could not be saved' }, 400);
  }

  return jsonResponse(request, { enabled: true });
});
