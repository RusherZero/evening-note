export function normalizeBasePath(value, fallback = '') {
  const configured = (value ?? fallback).trim();
  if (!configured || configured === '/') return '';
  if (/[?#]/.test(configured) || configured.includes('://')) {
    throw new Error(`Invalid deployment base path: ${configured}`);
  }

  const normalized = `/${configured.replace(/^\/+|\/+$/g, '')}`;
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid deployment base path: ${configured}`);
  }
  return normalized;
}

export function normalizeSiteUrl(value, basePath) {
  const siteUrl = new URL(value);
  const localDevelopment =
    siteUrl.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(siteUrl.hostname);
  if (siteUrl.protocol !== 'https:' && !localDevelopment) {
    throw new Error('The deployment site URL must use HTTPS.');
  }
  if (siteUrl.username || siteUrl.password || siteUrl.search || siteUrl.hash) {
    throw new Error('The deployment site URL must not contain credentials, a query, or a fragment.');
  }
  if (normalizeBasePath(siteUrl.pathname) !== basePath) {
    throw new Error(`The deployment site URL path must match ${basePath || '/'} exactly.`);
  }
  return `${siteUrl.origin}${basePath}`;
}
