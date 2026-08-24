import { constantTimeEqual, getAdminClient, namedSupabaseSecret } from '../_shared/auth.ts';
import { jsonResponse } from '../_shared/http.ts';
import { pushStatus, sendPush, type StoredSubscription } from '../_shared/push.ts';
import { classifyPushFailure, remainingTtlSeconds } from '../_shared/push-policy.ts';

type ClaimedDelivery = StoredSubscription & {
  delivery_id: string;
  claim_token: string;
  attempts: number;
  scheduled_for: string;
  local_date: string;
};

const CLAIM_BATCH_SIZE = 8;
const CLAIM_LEASE_SECONDS = 45;
const FUNCTION_BUDGET_MS = 50_000;
const MINIMUM_BATCH_BUDGET_MS = 12_000;

async function finish(
  delivery: ClaimedDelivery,
  outcome: 'sent' | 'retry' | 'expired' | 'failed',
  providerStatus: number | null,
  errorCode: string | null,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await getAdminClient().rpc('_internal_finish_delivery', {
      p_delivery_id: delivery.delivery_id,
      p_claim_token: delivery.claim_token,
      p_outcome: outcome,
      p_provider_status: providerStatus,
      p_error_code: errorCode,
    });

    if (!error && data === true) return;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }

  throw new Error('Delivery result could not be finalized');
}

async function processDelivery(delivery: ClaimedDelivery) {
  const ttl = remainingTtlSeconds(delivery.scheduled_for);
  if (ttl <= 0) {
    await finish(delivery, 'failed', null, 'delivery_window_elapsed');
    return 'failed';
  }

  let response: Awaited<ReturnType<typeof sendPush>>;
  try {
    response = await sendPush(delivery, delivery.local_date, ttl);
  } catch (error) {
    const status = pushStatus(error);
    const outcome = classifyPushFailure(status);
    await finish(
      delivery,
      outcome,
      status,
      outcome === 'expired' ? 'subscription_expired' : outcome === 'retry' ? 'transient_push_failure' : 'push_rejected',
    );
    return outcome;
  }

  await finish(delivery, 'sent', response.statusCode ?? 201, null);
  return 'sent';
}

Deno.serve(async (request) => {
  const deadline = Date.now() + FUNCTION_BUDGET_MS;
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed' }, 405);

  const expectedKey = namedSupabaseSecret('automations')
    || Deno.env.get('AUTOMATIONS_SECRET_KEY')
    || '';
  const providedKey = request.headers.get('apikey') || '';
  if (!expectedKey || !constantTimeEqual(expectedKey, providedKey)) {
    return jsonResponse(request, { error: 'Authentication required' }, 401);
  }

  const admin = getAdminClient();
  const { error: enqueueError } = await admin.rpc('_internal_enqueue_due_reminders', { p_limit: 500 });
  if (enqueueError) return jsonResponse(request, { error: 'Reminder queue unavailable' }, 503);

  const results: string[] = [];
  let finalizationFailures = 0;

  // Claim only work that can start immediately. This keeps leases meaningful
  // and avoids a large early claim expiring while earlier network requests run.
  while (Date.now() + MINIMUM_BATCH_BUDGET_MS < deadline) {
    const { data, error: claimError } = await admin.rpc('_internal_claim_deliveries', {
      p_limit: CLAIM_BATCH_SIZE,
      p_lease_seconds: CLAIM_LEASE_SECONDS,
    });
    if (claimError) return jsonResponse(request, { error: 'Reminder queue unavailable' }, 503);

    const deliveries = (Array.isArray(data) ? data : []) as ClaimedDelivery[];
    if (deliveries.length === 0) break;

    const settled = await Promise.allSettled(deliveries.map(processDelivery));
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        finalizationFailures += 1;
      }
    }

    if (finalizationFailures > 0) break;
  }

  const summary = {
    processed: results.length,
    sent: results.filter((result) => result === 'sent').length,
    retrying: results.filter((result) => result === 'retry').length,
    disabled: results.filter((result) => result === 'expired').length,
    failed: results.filter((result) => result === 'failed').length,
    finalizationFailures,
  };

  if (finalizationFailures > 0) {
    return jsonResponse(request, { error: 'Reminder results could not be recorded', ...summary }, 503);
  }

  return jsonResponse(request, summary);
});
