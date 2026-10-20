import { PROJECT } from './setup-project.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { PROJECT_ROOT, checkContract, countStatuses, displayPath, safeJoin, stamp } from '../skills/run-test-plan/scripts/lib.mjs';

const tc = {
  id: 'TC-1',
  steps: [
    { n: 1, action: 'Open the shop' },
    { n: 2, action: 'Add to cart', evidenceRequired: false },
  ],
};
const passing = {
  testCaseId: 'TC-1',
  status: 'pass',
  summary: 'The cart shows the item.',
  steps: [
    { n: 1, status: 'pass', evidence: ['01-shop.png'] },
    { n: 2, status: 'pass' },
  ],
  evidence: [{ file: '01-shop.png' }],
};

describe('lib', () => {
  test('the project comes from QA_PROJECT_DIR', () => {
    assert.equal(PROJECT_ROOT, PROJECT);
  });

  test('safeJoin keeps crafted ids inside the base folder', () => {
    const base = join(PROJECT, '.qa', 'runs');
    assert.equal(safeJoin(base, 'RUN-1', 'tc'), join(base, 'RUN-1', 'tc'));
    assert.throws(() => safeJoin(base, '..', 'config.json'), /escapes/);
    assert.throws(() => safeJoin(base, '../runs-evil'), /escapes/);
  });

  test('displayPath is relative inside the project and absolute outside it', () => {
    assert.equal(displayPath(join(PROJECT, '.qa', 'plans', 'X.plan.json')), '.qa/plans/X.plan.json');
    const outside = join(PROJECT, '..', 'elsewhere.txt');
    assert.equal(displayPath(outside), outside.split(/[\\/]/).join('/'));
  });

  test('stamp is a sortable local timestamp', () => {
    assert.equal(stamp(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405');
  });

  test('countStatuses counts every status, known or not', () => {
    const counts = countStatuses({ testCases: [{ status: 'pass' }, { status: 'pass' }, { status: 'fail' }, { status: 'odd' }] });
    assert.deepEqual({ total: counts.total, pass: counts.pass, fail: counts.fail, odd: counts.odd }, { total: 4, pass: 2, fail: 1, odd: 1 });
  });
});

describe('checkContract', () => {
  test('a complete result has no warnings', () => {
    assert.deepEqual(checkContract(tc, passing, ['01-shop.png']), []);
  });

  test('no result, no warnings', () => {
    assert.deepEqual(checkContract(tc, null, []), []);
  });

  test('flags a mismatched id, an unknown status and an empty summary', () => {
    const warnings = checkContract(tc, { ...passing, testCaseId: 'TC-9', status: 'ok', summary: ' ' }, ['01-shop.png']);
    assert.ok(warnings.some((w) => w.includes('TC-9')));
    assert.ok(warnings.some((w) => w.includes('status "ok"')));
    assert.ok(warnings.includes('summary is empty.'));
  });

  test('flags missing evidence and steps without evidence', () => {
    const result = { ...passing, steps: [{ n: 1, status: 'pass' }] };
    const warnings = checkContract(tc, result, []);
    assert.ok(warnings.includes('step 1 is pass without evidence.'));
    assert.ok(warnings.includes('step 2 has no reported result.'));
    assert.ok(warnings.includes('evidence "01-shop.png" is referenced but missing.'));
  });

  test('a failure needs a defect or a note', () => {
    const warnings = checkContract(tc, { ...passing, status: 'fail' }, ['01-shop.png']);
    assert.ok(warnings.includes('status is fail but no defect or note explains it.'));
    assert.deepEqual(checkContract(tc, { ...passing, status: 'fail', notes: 'Total is wrong.' }, ['01-shop.png']), []);
  });

  test('a requested recording must be in evidence', () => {
    const warnings = checkContract({ ...tc, record: true }, passing, ['01-shop.png']);
    assert.ok(warnings.includes('a recording was requested but no video is in evidence/.'));
    assert.deepEqual(checkContract({ ...tc, record: true }, passing, ['01-shop.png', 'run.mp4']), []);
  });

  test('reports unredacted secrets in text evidence', () => {
    const dir = join(PROJECT, 'evidence-secrets');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'request.json'), '{"user":"ana","password":"hunter2"}');
    writeFileSync(join(dir, 'redacted.json'), '{"user":"ana","password":"***"}');
    const files = ['01-shop.png', 'request.json', 'redacted.json'];
    const warnings = checkContract(tc, passing, files, {}, dir);
    assert.deepEqual(warnings, ['"request.json" seems to contain an unredacted secret.']);
  });
});
