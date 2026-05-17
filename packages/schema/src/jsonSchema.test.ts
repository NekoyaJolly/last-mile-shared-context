/**
 * JSON Schema 生成 utility のテスト。
 */
import { describe, it, expect } from 'vitest';

import {
  aiDebugContextJsonSchema,
  lastMileBundleJsonSchema,
} from './jsonSchema.js';

describe('jsonSchema utilities', () => {
  it('lastMileBundleJsonSchema は title と properties を持つ JSON Schema を返す', () => {
    const schema = lastMileBundleJsonSchema() as Record<string, unknown>;
    expect(schema).toBeTruthy();
    // zod-to-json-schema は `$ref` ベースで返すため、トップは `$ref` + `definitions` 形式
    // 名前を渡しているので definitions.LastMileBundle が存在することを確認
    expect(schema).toHaveProperty('$ref');
    expect(schema).toHaveProperty('definitions');
    const defs = schema.definitions as Record<string, unknown>;
    expect(defs).toHaveProperty('LastMileBundle');
  });

  it('aiDebugContextJsonSchema は AiDebugContext definition を持つ', () => {
    const schema = aiDebugContextJsonSchema() as Record<string, unknown>;
    expect(schema).toHaveProperty('definitions');
    const defs = schema.definitions as Record<string, unknown>;
    expect(defs).toHaveProperty('AiDebugContext');
  });
});
