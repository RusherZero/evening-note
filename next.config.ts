import type { NextConfig } from 'next';

const isGitHubPages = process.env.DEPLOY_TARGET === 'github-pages';
const configuredBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '/evening-note').trim();
const pagesBasePath =
  !configuredBasePath || configuredBasePath === '/'
    ? ''
    : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: 'export',
      basePath: pagesBasePath || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
