/**
 * @last-mile-context/core
 *
 * Bundle normalizer / redaction / issue classifier。
 * 取得手段 (CDP / Playwright / CLI / MCP) は何であれ、ここを経由して
 * 「最終的に同じ Bundle 形状」に揃える (WBS §21.2 Schema First)。
 */
export * from './normalize.js';
export * from './redaction.js';
export * from './classifyIssue.js';
