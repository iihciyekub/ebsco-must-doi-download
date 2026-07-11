import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, normalizeVersion } from '../src/updater.mjs';

test('normalizes semantic GitHub release tags', () => {
  assert.equal(normalizeVersion('1.2.3').tag, 'v1.2.3');
  assert.equal(normalizeVersion('v2.0.0-beta.1').tag, 'v2.0.0-beta.1');
  assert.throws(() => normalizeVersion('latest'), /格式无效/);
});

test('compares semantic versions', () => {
  assert.equal(compareVersions('v1.1.0', 'v1.0.9'), 1);
  assert.equal(compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.equal(compareVersions('v1.0.0-beta.1', 'v1.0.0'), -1);
});
