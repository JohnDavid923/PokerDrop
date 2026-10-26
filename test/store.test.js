import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server.js';

const act = (socket, type, id) => socket.timeout(4000).emitWithAck('action', { type, id });
async function client(url) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const initial = once(socket, 'store');
  await once(socket, 'connect'); await initial;
  assert.equal(socket.io.engine.transport.name, 'websocket');
  return socket;
}
async function setup(t, options = {}) {
  const store = createStore({ dataFile: null, ...options });
  store.server.listen(0, '127.0.0.1'); await once(store.server, 'listening');
  const url = `http://127.0.0.1:${store.server.address().port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.disconnect()); await store.close(); });
  return { store, url, async connect() { const s = await client(url); sockets.push(s); return s; } };
}

test('12 real WebSocket clients receive identical inventory and cannot oversell the last stock', async t => {
  const { store, connect } = await setup(t);
  const sockets = await Promise.all(Array.from({ length: 12 }, connect));
  assert.equal(store.state().online, 12);
  const seen = new Map(); sockets.forEach((s, i) => s.on('store', state => seen.set(i, state)));
  const results = await Promise.all(sockets.map(s => act(s, 'reserve', 'chips')));
  assert.equal(results.filter(r => r.ok).length, 5);
  assert.equal(results.filter(r => !r.ok).length, 7);
  const wanted = store.state().revision;
  await new Promise((resolve, reject) => {
    const until = Date.now() + 4000;
    const check = setInterval(() => {
      if (seen.size === 12 && [...seen.values()].every(s => s.revision === wanted)) { clearInterval(check); resolve(); }
      else if (Date.now() > until) { clearInterval(check); reject(new Error('Clients did not synchronize')); }
    }, 10);
  });
  for (const state of seen.values()) { assert.equal(state.products.find(p => p.id === 'chips').available, 0); assert.equal(state.online, 12); }
  const winner = sockets[results.findIndex(r => r.ok)];
  assert.equal((await act(winner, 'checkout')).ok, true);
  assert.equal((await act(winner, 'checkout')).ok, false, 'Cannot checkout the same cart twice');
  assert.equal((await act(sockets[results.findIndex(r => !r.ok)], 'reserve', 'chips')).ok, false);
  const holder = sockets[results.findIndex((r, i) => r.ok && sockets[i] !== winner)];
  await act(holder, 'release', 'chips');
  assert.equal(store.state().products.find(p => p.id === 'chips').available, 1);
});

test('reservations return on disconnect and expiration; invalid actions cannot mutate stock', async t => {
  const { store, connect } = await setup(t, { leaseMs: 90 });
  const a = await connect(), b = await connect();
  assert.equal((await act(a, 'reserve', '__proto__')).ok, false);
  assert.equal((await act(a, 'release', 'tee')).ok, false);
  assert.equal((await act(a, 'reserve', 'tee')).ok, true);
  const expired = once(a, 'notice'); await expired;
  assert.equal(store.state().products.find(p => p.id === 'tee').available, 12);
  assert.equal((await act(a, 'checkout')).ok, false);
  await act(b, 'reserve', 'tee');
  const disconnected = once(store.io.sockets.sockets.get(b.id), 'disconnect'); b.disconnect(); await disconnected;
  assert.equal(store.state().products.find(p => p.id === 'tee').available, 12);
});

test('completed purchases survive a server restart and totals are calculated on server', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'poker-drop-test-'));
  const dataFile = join(dir, 'inventory.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { connect } = await setup(t, { dataFile });
  const a = await connect();
  await act(a, 'reserve', 'tee'); await act(a, 'reserve', 'cap');
  const result = await act(a, 'checkout');
  assert.equal(result.order.total, 5200);
  const restarted = createStore({ dataFile });
  assert.equal(restarted.state().products.find(p => p.id === 'tee').available, 11);
  assert.equal(restarted.state().products.find(p => p.id === 'cap').available, 9);
  await restarted.close();
});
