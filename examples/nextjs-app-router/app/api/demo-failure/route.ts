/**
 * 意図的に 500 を返す API route (WBS §15.3 P10-04)。
 *
 * Last-Mile 観察のデモ用に、UI 側 fetch が必ず失敗する状況を再現する。
 * Phase 4 (cdp-collector) や Phase 7 (playwright-adapter) が wire されたあと、
 * 本 route のレスポンスは「failedRequests」や「networkErrors」として
 * Bundle に取り込まれる。
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      error: 'Demo failure',
      reason:
        'This endpoint always returns HTTP 500 to demonstrate Last-Mile observation.',
    },
    { status: 500 },
  );
}
