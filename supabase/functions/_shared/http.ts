const DEFAULT_ORIGIN = 'http://localhost:3000';

function allowedOrigin(request: Request): string {
  const configured = (Deno.env.get('APP_ORIGIN') || DEFAULT_ORIGIN).replace(/\/$/, '');
  const origin = request.headers.get('origin');
  if (!origin) return configured;
  if (origin === configured || origin === DEFAULT_ORIGIN) return origin;
  return configured;
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
