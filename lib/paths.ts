export function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === '/') return '';

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

export function withBasePath(path: string, basePath = ''): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeBasePath(basePath)}${normalizedPath}`;
}

export function isPathInsideBasePath(pathname: string, basePath = ''): boolean {
  const normalizedBasePath = normalizeBasePath(basePath);
  if (!normalizedBasePath) return pathname.startsWith('/');
  return pathname === normalizedBasePath || pathname.startsWith(`${normalizedBasePath}/`);
}
