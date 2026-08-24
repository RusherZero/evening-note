const DEFAULT_ORIGIN = 'http://localhost:3000';

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): string[] {
  const primary = originOf(Deno.env.get('APP_ORIGIN') || DEFAULT_ORIGIN) || DEFAULT_ORIGIN;
  const additional = (Deno.env.get('APP_ORIGINS') || '')
    .split(',')
    .map((value) => originOf(value.trim()))
    .filter((value): value is string => Boolean(value));
  return [...new Set([primary, ...additional, DEFAULT_ORIGIN])];
}

function allowedOrigin(request: Request): string {
  const configured = configuredOrigins();
  const origin = request.headers.get('origin');
  if (origin && configured.includes(origin)) return origin;
  return configured[0];
}

export function corsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function optionsResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
