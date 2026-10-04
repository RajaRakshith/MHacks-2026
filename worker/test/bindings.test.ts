import assert from 'node:assert/strict';
import test from 'node:test';

// The generated bindings are built with spacetime CLI 2.10; an older installed
// spacetimedb package throws at import time and leaves the worker dead.
test('generated module_bindings import under the installed spacetimedb', async () => {
  const bindings = await import('../src/module_bindings/index.js');
  assert.equal(typeof bindings.DbConnection, 'function');
  assert.ok(bindings.tables.transferIntents);
  assert.equal(typeof bindings.reducers, 'object');
});
