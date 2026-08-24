import type { Metadata, Viewport } from 'next';
import './globals.css';

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const appUrl = new URL(configuredSiteUrl.endsWith('/') ? configuredSiteUrl : `${configuredSiteUrl}/`);
const appAssetUrl = (path: string) => new URL(path.replace(/^\/+/, ''), appUrl).href;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1d3930',
};

export const metadata: Metadata = {
  metadataBase: appUrl,
  title: {
    default: 'Evening Note',
    template: '%s · Evening Note',
  },
  description: 'A quiet daily note, with a gentle reminder at 19:45.',
  applicationName: 'Evening Note',
  manifest: appAssetUrl('manifest.webmanifest'),
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    title: 'Evening Note',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: appAssetUrl('favicon-32.png'), sizes: '32x32', type: 'image/png' },
      { url: appAssetUrl('icon-192.png'), sizes: '192x192', type: 'image/png' },
      { url: appAssetUrl('icon-512.png'), sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: appAssetUrl('apple-touch-icon.png'), sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    title: 'Evening Note',
    description: 'A quiet place for one thought from your day.',
    url: appUrl,
    siteName: 'Evening Note',
    images: [{ url: appAssetUrl('og.png'), width: 1731, height: 909, alt: 'Evening Note — A quiet place for one thought from your day.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Evening Note',
    description: 'A quiet place for one thought from your day.',
    images: [appAssetUrl('og.png')],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
