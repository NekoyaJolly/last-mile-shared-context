/**
 * classifyIssue のテスト。
 *
 * 雛形なので各分岐 1 件ずつ:
 * - server error → 'Server'
 * - 5xx failed request → 'API'
 * - 4xx / network failure → 'Network'
 * - console error → 'UI'
 * - expected/actual mismatch のみ → 'UX'
 * - console warning のみ → 'UX'
 * - 何もない → 'NoIssue'
 */
import { describe, it, expect } from 'vitest';

import { classifyIssue } from './classifyIssue.js';
import { makeBundle } from './testFixtures.js';

describe('classifyIssue', () => {
  it('server.errors があれば Server', () => {
    const result = classifyIssue(
      makeBundle({
        server: {
          errors: [{ level: 'error', message: 'DB connection lost' }],
          hints: [],
        },
      }),
    );
    expect(result.primary).toBe('Server');
  });

  it('failedRequests に 5xx があれば API', () => {
    const result = classifyIssue(
      makeBundle({
        network: {
          failedRequests: [{ method: 'POST', url: '/api/foo', status: 500 }],
          recentRequests: [],
        },
      }),
    );
    expect(result.primary).toBe('API');
  });

  it('failedRequests が 4xx / 接続失敗のみなら Network', () => {
    const result = classifyIssue(
      makeBundle({
        network: {
          failedRequests: [{ method: 'GET', url: '/api/foo', errorText: 'net::ERR_FAILED' }],
          recentRequests: [],
        },
      }),
    );
    expect(result.primary).toBe('Network');
  });

  it('console.errors のみなら UI', () => {
    const result = classifyIssue(
      makeBundle({
        console: { errors: [{ level: 'error', text: 'TypeError: undefined' }], warnings: [] },
      }),
    );
    expect(result.primary).toBe('UI');
  });

  it('userObservation.expected !== actual のみなら UX', () => {
    const result = classifyIssue(
      makeBundle({
        userObservation: {
          lastAction: 'click button',
          expected: 'toast appears',
          actual: 'nothing happens',
          notes: '',
        },
      }),
    );
    expect(result.primary).toBe('UX');
  });

  it('console.warnings のみなら UX', () => {
    const result = classifyIssue(
      makeBundle({
        console: { errors: [], warnings: [{ level: 'warning', text: 'deprecated API' }] },
      }),
    );
    expect(result.primary).toBe('UX');
  });

  it('何の兆候もなければ NoIssue', () => {
    const result = classifyIssue(makeBundle());
    expect(result.primary).toBe('NoIssue');
  });

  it('複数兆候があるときは candidates に複数入る', () => {
    const result = classifyIssue(
      makeBundle({
        console: { errors: [{ level: 'error', text: 'x' }], warnings: [] },
        network: {
          failedRequests: [{ method: 'POST', url: '/api/foo', status: 500 }],
          recentRequests: [],
        },
        userObservation: {
          lastAction: 'click',
          expected: 'a',
          actual: 'b',
          notes: '',
        },
      }),
    );
    expect(result.candidates.length).toBeGreaterThan(1);
    // server > API > UI > UX の優先順
    expect(result.primary).toBe('API');
  });
});
