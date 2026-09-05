import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countDiagnostics, increasedDiagnostics } from './lint-baseline.mjs';

test('rejects new files, new rules, and higher counts', () => {
  assert.deepEqual(increasedDiagnostics({ a: 2, b: 1 }, { a: 1 }), [['a', 2], ['b', 1]]);
});
test('permits reducing existing debt', () => {
  assert.deepEqual(increasedDiagnostics({ a: 1 }, { a: 2, b: 1 }), []);
});
test('never accepts a fatal parsing error as baseline debt', () => {
  assert.throws(() => countDiagnostics([{ filePath: '/project/a.ts', messages: [{ fatal: true, message: 'Invalid syntax' }] }], '/project'), /Invalid syntax/);
});
