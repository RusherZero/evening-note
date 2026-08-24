import { normalizeBasePath, normalizeSiteUrl } from './deployment-paths.mjs';

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_BASE_PATH',
];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(`Missing GitHub Actions repository variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('https://')) {
  console.error('NEXT_PUBLIC_SUPABASE_URL must use HTTPS.');
  process.exit(1);
}

try {
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, basePath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log('GitHub Pages public configuration is present.');
