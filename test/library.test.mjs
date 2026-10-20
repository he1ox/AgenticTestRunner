import './setup-project.mjs';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseLiteral } from '../skills/run-test-plan/scripts/export-playwright.mjs';
import { buildSchedule, classify } from '../skills/run-test-plan/scripts/schedule.mjs';
import { cleanTags, fillSecrets, jsEscape, needsSecret, slugify, splitTestId } from '../skills/run-test-plan/scripts/tests.mjs';

describe('test library helpers', () => {
  test('splitTestId takes exactly PLAN/TC with safe characters', () => {
    assert.deepEqual(splitTestId('SHOP-42/TC-1'), { planId: 'SHOP-42', tcId: 'TC-1' });
    for (const bad of ['SHOP-42', 'A/B/C', '../x/TC-1', 'A/B c', '', undefined])
      assert.throws(() => splitTestId(bad), (e) => e.status === 400);
  });

  test('secrets are escaped for a JavaScript string', () => {
    assert.equal(jsEscape(`it's "x" \`y\` \\ ${'${z}'}\nnext`), "it\\'s \\\"x\\\" \\`y\\` \\\\ \\${z}\\nnext");
    assert.equal(fillSecrets("fill('{{user}}', '{{secret}}')", { user: 'ana', secret: "p'w" }), "fill('ana', 'p\\'w')");
    assert.equal(fillSecrets('{{user}}', {}), '');
  });

  test('needsSecret looks at setup and steps', () => {
    assert.equal(needsSecret({ setup: ['{{secret}}'], steps: [] }), true);
    assert.equal(needsSecret({ setup: [], steps: [{ code: 'click()' }], notes: '{{secret}}' }), false);
  });

  test('cleanTags trims, lowercases and dedupes', () => {
    assert.deepEqual(cleanTags(' Smoke, checkout ,smoke,,'), ['smoke', 'checkout']);
    assert.equal(cleanTags(Array.from({ length: 40 }, (_, i) => `t${i}`)).length, 30);
  });

  test('slugify keeps file names portable', () => {
    assert.equal(slugify('Regresión: Pago con cupón!'), 'regresion-pago-con-cupon');
    assert.equal(slugify('...'), 'test-plan');
    assert.equal(slugify('x'.repeat(80)).length, 60);
  });
});

describe('parseLiteral', () => {
  test('reads plain data with comments and any quote style', () => {
    const value = parseLiteral(`[
      // a mark
      { selector: '#total', label: "Total \\u00e9", n: -1.5e2, ok: true, none: null, 'x-y': \`t\` },
    ]`);
    assert.deepEqual(value, [{ selector: '#total', label: 'Total é', n: -150, ok: true, none: null, 'x-y': 't' }]);
  });

  test('never runs code', () => {
    for (const source of ['[alert(1)]', '[`${x}`]', '{a: b}', '[1] ; x', '{__proto__: 1}.x'])
      assert.throws(() => parseLiteral(source), /not a plain literal/, source);
  });

  test('__proto__ is an ordinary key', () => {
    const value = parseLiteral('{"__proto__": {"polluted": true}}');
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.equal({}.polluted, undefined);
  });
});

describe('schedule', () => {
  const plan = { id: 'P', defaults: {} };
  const steps = (n, action = 'Open the page') => Array.from({ length: n }, (_, i) => ({ n: i + 1, action }));

  test('read-only cases are simple', () => {
    assert.equal(classify({ steps: steps(2) }, plan).tier, 'simple');
  });

  test('writing data, in English or Spanish, is standard', () => {
    assert.equal(classify({ steps: steps(1, 'Submit the order') }, plan).tier, 'standard');
    assert.equal(classify({ steps: steps(1, 'Pagar el pedido') }, plan).tier, 'standard');
    assert.equal(classify({ steps: steps(1, 'Submit the order'), tags: ['readonly'] }, plan).tier, 'simple');
  });

  test('long, unstable or reference-checked cases are complex', () => {
    assert.equal(classify({ steps: steps(11) }, plan).tier, 'complex');
    assert.equal(classify({ steps: steps(1) }, plan, ['rejected']).tier, 'complex');
    assert.equal(classify({ steps: steps(1), referenceCheck: 'always' }, plan).tier, 'complex');
  });

  test('the plan can pin a tier', () => {
    assert.deepEqual(classify({ steps: steps(20), agent: { complexity: 'simple' } }, plan), { tier: 'simple', reasons: ['set in the plan'] });
  });

  test('groups are split into batches and take their hardest tier', () => {
    const cases = ['A', 'B', 'C', 'D'].map((id, i) => ({ id, group: 'g', steps: steps(i === 3 ? 11 : 1) }));
    const schedule = buildSchedule(plan, cases, new Map(), 'codex');
    assert.equal(schedule.maxParallel, 1);
    assert.deepEqual(
      schedule.batches.map((b) => [b.id, b.cases, b.tier, b.pool]),
      [
        ['g#1', ['A', 'B', 'C'], 'simple', false],
        ['g#2', ['D'], 'complex', false],
      ],
    );
    assert.equal(buildSchedule(plan, cases.slice(0, 1), new Map(), 'claude-code').batches[0].model, 'haiku');
  });
});
