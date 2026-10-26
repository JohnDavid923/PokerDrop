// Verifies the deployed transport and shared state without completing purchases.
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.argv[2] || 'http://localhost:3000';
const clients = [];
const latest = new Map();
const waitUntil = async predicate => {
  const until = Date.now() + 20_000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for shared state');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
try {
  const page = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /The Poker Drop/);
  await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 15_000 });
    clients.push(socket);
    socket.on('connect_error', reject);
    socket.on('store', state => { latest.set(i, state); resolve(); });
  })));
  assert.ok(clients.every(s => s.io.engine.transport.name === 'websocket'));
  await waitUntil(() => latest.size === 12 && [...latest.values()].every(s => s.online >= 12));
  const initial = latest.get(0);
  const product = initial.products.find(p => p.available > 0);
  assert.ok(product, 'Need one available item to verify reservation and release');
  const reserved = await clients[0].timeout(15_000).emitWithAck('action', { type: 'reserve', id: product.id });
  assert.equal(reserved.ok, true);
  await waitUntil(() => [...latest.values()].every(s => s.revision > initial.revision && s.products.find(p => p.id === product.id).available === product.available - 1));
  const revision = latest.get(0).revision;
  const released = await clients[0].timeout(15_000).emitWithAck('action', { type: 'release', id: product.id });
  assert.equal(released.ok, true);
  await waitUntil(() => [...latest.values()].every(s => s.revision > revision && s.products.find(p => p.id === product.id).available === product.available));
  console.log(JSON.stringify({ url, http: page.status, authenticationRequired: false, websocketClients: 12, sharedReservation: 'PASS', sharedRelease: 'PASS' }, null, 2));
} finally { clients.forEach(s => s.disconnect()); }
