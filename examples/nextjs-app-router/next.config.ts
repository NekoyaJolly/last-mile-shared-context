import type { NextConfig } from 'next';

/**
 * Next.js 15 App Router の最小設定。
 *
 * 設計判断:
 *  - workspace 内の `@last-mile-context/*` パッケージは `dist/` (tsup ビルド済み) を import するため、
 *    `transpilePackages` で transpile を強制する必要はない。
 *  - `reactStrictMode` は明示的に有効化 (Next.js 15 default は true だが意図を明示)。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
