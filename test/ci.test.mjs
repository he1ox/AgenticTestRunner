import './setup-project.mjs';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { junitXml, parseFailOn } from '../skills/run-test-plan/scripts/ci.mjs';

describe('parseFailOn', () => {
  test('defaults to fail and blocked', () => {
    assert.deepEqual([...parseFailOn()], ['fail', 'blocked']);
    assert.deepEqual([...parseFailOn(true)], ['fail', 'blocked']);
  });

  test('accepts a list, one status or none', () => {
    assert.deepEqual([...parseFailOn('FAIL')], ['fail']);
    assert.deepEqual([...parseFailOn(' fail , blocked ')], ['fail', 'blocked']);
    assert.equal(parseFailOn('none').size, 0);
  });

  test('rejects anything else', () => {
    assert.throws(() => parseFailOn('pass'), /--fail-on takes/);
    assert.throws(() => parseFailOn(''), /--fail-on takes/);
  });
});

const result = (status, extra = {}) => ({
  status,
  summary: `${status} summary`,
  startedAt: '2026-10-01T10:00:00Z',
  finishedAt: '2026-10-01T10:00:02.5Z',
  steps: [{ n: 1, status, actual: 'seen' }],
  ...extra,
});
const run = {
  id: 'RUN-1',
  plan: { id: 'SHOP-42', title: 'Shop <checkout> & "coupons"' },
  meta: { createdAt: '2026-10-01T10:00:00.000Z' },
  testCases: [
    { id: 'TC-1', title: 'passes', status: 'pass', files: ['01.png'], result: result('pass') },
    { id: 'TC-2', title: 'fails', status: 'fail', files: [], result: result('fail', { notes: 'Total was 0' }) },
    { id: 'TC-3', title: 'blocked', status: 'blocked', files: [], result: result('blocked', { blockedReason: 'env' }) },
    { id: 'TC-4', title: 'never ran', status: 'pending', files: [], result: null },
  ],
};

describe('junitXml', () => {
  test('counts failures, errors and time for the default gate', () => {
    const xml = junitXml(run);
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites name="qa-runner" tests="4" failures="1" errors="2" skipped="0" time="7.500">/);
    assert.match(xml, /<failure type="fail" message="fail summary">Total was 0/);
    assert.match(xml, /<error type="blocked:env"/);
    assert.match(xml, /<error type="incomplete" message="the case did not finish \(status pending\)"/);
    assert.match(xml, /\[\[ATTACHMENT\|\.qa\/runs\/RUN-1\/tc\/TC-1\/evidence\/01\.png\]\]/);
  });

  test('statuses left out of --fail-on are reported as skipped', () => {
    const xml = junitXml(run, { failOn: parseFailOn('none') });
    assert.match(xml, /tests="4" failures="0" errors="1" skipped="2"/);
    assert.match(xml, /<skipped message="fail: fail summary"\/>/);
  });

  test('escapes markup and strips characters XML forbids', () => {
    const xml = junitXml({
      ...run,
      testCases: [{ ...run.testCases[0], title: 'a\u0001b <i>', result: result('pass', { summary: '\x1b[31mred\x1b[0m & co' }) }],
    });
    assert.ok(xml.includes('name="Shop &lt;checkout&gt; &amp; &quot;coupons&quot;"'));
    assert.ok(xml.includes('name="TC-1: ab &lt;i&gt;"'));
    assert.ok(xml.includes('<system-out>red &amp; co'));
    assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F]/);
  });
});
