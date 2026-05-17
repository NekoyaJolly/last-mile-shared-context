/**
 * Root layout for the Last-Mile Shared Context Next.js 15 example.
 *
 * App Router の規約上、`app/layout.tsx` は server component。
 * AI Debug Context の初期化は client component (`DebugContextProvider`) で行うため、
 * ここでは provider を render するだけにしておく。
 */
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { DebugContextProvider } from './_components/DebugContextProvider';

export const metadata: Metadata = {
  title: 'Last-Mile Shared Context — Next.js example',
  description:
    'Minimal demo for the Last-Mile Shared Context Protocol (Phase 10).',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="ja">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          margin: 0,
          padding: '2rem',
          maxWidth: '760px',
          marginInline: 'auto',
          lineHeight: 1.6,
        }}
      >
        <DebugContextProvider>{children}</DebugContextProvider>
      </body>
    </html>
  );
}
