import { PROJECT } from './setup-project.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { COLORS, isSidecar, normalize, readAnnotations, sidecarPath, writeAnnotations } from '../skills/run-test-plan/scripts/annotations.mjs';

describe('normalize', () => {
  test('turns a boundingBox() into padded geometry', () => {
    const rect = normalize({ id: 'r', type: 'rect', box: { x: 100, y: 50, width: 80, height: 20 }, color: 'green' }, 0, 'agent');
    assert.deepEqual(rect, { id: 'r', type: 'rect', author: 'agent', color: COLORS.green, x: 94, y: 44, w: 92, h: 32 });
  });

  test('clamps boxes to the image and keeps custom colors', () => {
    const rect = normalize({ id: 'r', type: 'ellipse', x: -5, y: 3, w: 10, h: 10, color: '#abc' }, 0, 'agent');
    assert.equal(rect.x, 0);
    assert.equal(rect.color, '#abc');
    assert.equal(normalize({ id: 'r', type: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'nope' }, 0).color, COLORS.red);
  });

  test('blur and spotlight carry no color', () => {
    assert.equal('color' in normalize({ id: 'b', type: 'blur', x: 0, y: 0, w: 5, h: 5 }, 0), false);
  });

  test('an arrow without a start gets one pointing at the target', () => {
    const arrow = normalize({ id: 'a', type: 'arrow', to: [400, 300] }, 0);
    assert.deepEqual(arrow.from, [270, 220]);
    assert.deepEqual(normalize({ id: 'a', type: 'arrow', to: [10, 10] }, 0).from, [140, 12]);
  });

  test('text and step need a position', () => {
    assert.equal(normalize({ id: 't', type: 'text', text: 'Total', x: 1, y: 2 }, 0).size, 18);
    assert.equal(normalize({ id: 's', type: 'step', x: 0, y: 0 }, 2).n, 3);
    assert.throws(() => normalize({ type: 'text', x: 1, y: 2 }, 4), /item 4: text needs "text"/);
    assert.throws(() => normalize({ type: 'step' }, 0), /step needs x, y or a box/);
  });

  test('rejects unknown types and empty boxes', () => {
    assert.throws(() => normalize({ type: 'circle' }, 1), /item 1: type must be one of/);
    assert.throws(() => normalize({ type: 'rect', x: 0, y: 0, w: 0, h: 5 }, 0), /needs x, y, w, h or a box/);
  });
});

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('sidecars', () => {
  test('write, then read back, without touching the image', () => {
    const dir = join(PROJECT, 'evidence-marks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '01.png'), Buffer.from(PNG_1X1, 'base64'));
    assert.deepEqual(readAnnotations(dir, '01.png').items, []);
    writeAnnotations(dir, '01.png', { items: [{ id: 'r1', type: 'rect', x: 1, y: 1, w: 5, h: 5 }], summary: 'mark total' });
    const saved = readAnnotations(dir, '01.png');
    assert.deepEqual(saved.items.map((i) => i.id), ['r1']);
    assert.equal(saved.history.length, 1);
    assert.ok(isSidecar(sidecarPath(dir, '01.png')));
    assert.ok(!isSidecar('01.png'));
  });
});
