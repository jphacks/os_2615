import test from 'node:test';
import assert from 'node:assert/strict';
import { startVisiblePolling } from '../src/services/visiblePolling.js';
function environment() {
  const listeners = new Set(), timers = new Map(); let id = 0;
  const target = { visibilityState: 'visible', addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  return { target, timers, setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: key => timers.delete(key),
    change(value) { target.visibilityState = value; for (const fn of listeners) fn(); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('遅い応答中は取得を重ねず、応答後から次回の待ち時間を数える', async () => {
  const env = environment(); let resolve, calls = 0;
  const stop = startVisiblePolling(() => { calls++; return new Promise(done => { resolve = done; }); }, env);
  assert.equal(calls, 1); assert.equal(env.timers.size, 0);
  env.change('hidden'); env.change('visible'); assert.equal(calls, 1);
  resolve(); await flush(); assert.equal(env.timers.size, 1);
  const next = [...env.timers.values()][0]; next(); assert.equal(calls, 2); assert.equal(env.timers.size, 0);
  stop(); resolve(); await flush(); assert.equal(env.timers.size, 0);
});
test('非表示中は取得せず、再表示で再開する。エラー後も継続できる', async () => {
  const env = environment(); env.target.visibilityState = 'hidden'; let calls = 0, errors = 0;
  const stop = startVisiblePolling(async () => { calls++; throw new Error('offline'); }, { ...env, onError: () => errors++ });
  assert.equal(calls, 0);
  env.change('visible'); await flush(); assert.equal(calls, 1); assert.equal(errors, 1); assert.equal(env.timers.size, 1);
  env.change('hidden'); assert.equal(env.timers.size, 0);
  stop(); env.change('visible'); assert.equal(calls, 1);
});
