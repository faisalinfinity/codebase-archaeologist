import type { Metadata } from 'next';
import { IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/site-header';

import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: 'Codebase Archaeologist',
  description:
    'Understand what a GitHub codebase does, why it exists, how it evolved, and what changing it could affect.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
