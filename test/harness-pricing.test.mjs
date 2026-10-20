import './setup-project.mjs';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HARNESSES, browserRegistration, defaultModel, hasPool, resolveHarness } from '../skills/run-test-plan/scripts/harness.mjs';
import { costOf, priceFor, promptTokens } from '../skills/run-test-plan/scripts/pricing.mjs';

describe('harness', () => {
  test('a flag wins and is case-insensitive', () => {
    assert.equal(resolveHarness('Codex'), 'codex');
  });

  test('falls back to generic, or claude-code inside Claude Code', (t) => {
    assert.equal(resolveHarness(), 'generic');
    process.env.CLAUDECODE = '1';
    t.after(() => delete process.env.CLAUDECODE);
    assert.equal(resolveHarness(), 'claude-code');
  });

  test('QA_HARNESS beats detection', (t) => {
    process.env.QA_HARNESS = 'gemini';
    t.after(() => delete process.env.QA_HARNESS);
    assert.equal(resolveHarness(), 'gemini');
  });

  test('rejects an unknown harness', () => {
    assert.throws(() => resolveHarness('emacs'), /unknown harness "emacs"/);
  });

  test('only Claude Code has a browser pool and default models', () => {
    assert.equal(hasPool('claude-code'), true);
    assert.equal(defaultModel('claude-code', 'simple'), 'haiku');
    for (const h of HARNESSES.filter((h) => h !== 'claude-code')) {
      assert.equal(hasPool(h), false);
      assert.equal(defaultModel(h, 'standard'), null);
    }
  });

  test('every harness gets registration instructions that name the script', () => {
    const script = '/opt/qa runner/browser-mcp.mjs';
    for (const h of HARNESSES) {
      const text = browserRegistration(h, script);
      assert.ok(text.includes('browser-mcp.mjs'), h);
      assert.ok(text.includes('shared'), h);
    }
    assert.equal(browserRegistration('claude-code', script), 'claude mcp add playwright -- node "/opt/qa runner/browser-mcp.mjs" shared');
  });
});

describe('pricing', () => {
  test('aliases, dated ids and provider prefixes resolve to a known model', () => {
    assert.equal(priceFor('sonnet').id, 'claude-sonnet-5-5');
    assert.equal(priceFor('claude-opus-4-6-20260101').id, 'claude-opus-4-6');
    assert.equal(priceFor('anthropic/claude-haiku-4-5').id, 'claude-haiku-4-5');
  });

  test('unknown models are never priced as another model', () => {
    for (const model of [undefined, '', 'unknown', 'session', 'gpt-9']) assert.equal(priceFor(model), null);
    assert.equal(costOf('gpt-9', { input: 1 }), null);
  });

  test('cache rates default from the input price', () => {
    const p = priceFor('claude-opus-4-6');
    assert.deepEqual([p.cacheRead, p.cacheWrite5m, p.cacheWrite1h], [0.5, 6.25, 10]);
  });

  test('costOf sums every token kind, plus the long-context part', () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    assert.equal(costOf('claude-opus-4-6', { ...zero, input: 1e6, output: 1e6 }), 30);
    const haiku = costOf('haiku', { ...zero, input: 1e6, long: { ...zero, input: 1e6 } });
    assert.equal(haiku, 0.1 + 0.5);
  });

  test('promptTokens adds every input the model read', () => {
    assert.equal(promptTokens({ input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 }), 6);
    assert.equal(promptTokens({}), 0);
  });
});
