import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
export const catalog = [
  { id: 'tee', name: 'The River Tee', category: 'Apparel', price: 2800, stock: 12, type: 'tee', color: '#244b3c', detail: 'Forest green · unisex M', description: 'A soft cotton staple for the long game.' },
  { id: 'cap', name: 'All In Cap', category: 'Apparel', price: 2400, stock: 10, type: 'cap', color: '#252825', detail: 'Washed black · adjustable', description: 'Low profile. High stakes. An everyday classic.' },
  { id: 'hoodie', name: 'After Hours Hoodie', category: 'Apparel', price: 5800, stock: 8, type: 'hoodie', color: '#b6ad98', detail: 'Oatmeal · unisex L', description: 'Heavyweight comfort for one more hand.' },
  { id: 'protector', name: 'Lucky Spade', category: 'Accessories', price: 1800, stock: 6, type: 'protector', color: '#cbb479', detail: 'Brass finish · 40 mm', description: 'A little luck to keep your cards protected.' },
  { id: 'chips', name: 'The Home Game Set', category: 'Table essentials', price: 8900, stock: 5, type: 'chips', color: '#244b3c', detail: '500 weighted chips · travel case', description: 'Bring a proper card room to your kitchen table.' },
  { id: 'cards', name: 'House Deck', category: 'Table essentials', price: 1400, stock: 15, type: 'cards', color: '#9d4237', detail: '54 cards · linen finish', description: 'A fresh deck. A clean slate. Your next good hand.' }
];

export function createStore({ dataFile = join(root, 'data', 'inventory.json'), leaseMs = 5 * 60_000 } = {}) {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, { transports: ['websocket'], maxHttpBufferSize: 4096 });
  const sold = Object.fromEntries(catalog.map(p => [p.id, 0]));
  if (dataFile) {
    try {
      const saved = JSON.parse(readFileSync(dataFile, 'utf8'));
      for (const p of catalog) {
        if (!Number.isInteger(saved[p.id]) || saved[p.id] < 0 || saved[p.id] > p.stock) throw new Error('Invalid inventory file');
        sold[p.id] = saved[p.id];
      }
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  const shoppers = new Map();
  let revision = 0;
  let activity = [];
  const available = id => catalog.find(p => p.id === id).stock - sold[id] - [...shoppers.values()].reduce((n, s) => n + (s.cart[id] || 0), 0);
  function state() {
    return { revision, online: shoppers.size, products: catalog.map(p => ({ ...p, available: available(p.id) })), activity };
  }
  function privateState(socket, shopper) { socket.emit('cart', { items: shopper.cart, expiresAt: shopper.expiresAt, leaseMs }); }
  function broadcast() { revision++; io.emit('store', state()); }
  function log(message) { activity = [{ id: randomUUID(), message, at: Date.now() }, ...activity].slice(0, 8); }
  function persist(next) {
    if (!dataFile) return;
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile + '.tmp', JSON.stringify(next));
    renameSync(dataFile + '.tmp', dataFile);
  }
  function expire(socket, shopper) {
    if (!shopper.expiresAt || shopper.expiresAt > Date.now()) return false;
    shopper.cart = {}; shopper.expiresAt = null;
    privateState(socket, shopper);
    socket.emit('notice', 'Your reservation expired. The items are available to everyone again.');
    log('A reservation expired. Items returned to the drop.');
    broadcast(); return true;
  }
  io.on('connection', socket => {
    const shopper = { cart: {}, expiresAt: null, hits: [] };
    shoppers.set(socket.id, shopper);
    privateState(socket, shopper); broadcast();
    socket.on('action', (action, ack) => {
      const respond = typeof ack === 'function' ? ack : () => {};
      expire(socket, shopper);
      const now = Date.now();
      shopper.hits = shopper.hits.filter(t => t > now - 5000);
      if (shopper.hits.length >= 25) return respond({ ok: false, error: 'A little slower, please. Try again in a moment.' });
      shopper.hits.push(now);
      if (!action || typeof action !== 'object') return respond({ ok: false, error: 'Invalid action.' });
      if (action.type === 'checkout') {
        const lines = catalog.filter(p => shopper.cart[p.id]).map(p => ({ id: p.id, name: p.name, quantity: shopper.cart[p.id], price: p.price }));
        if (!lines.length) return respond({ ok: false, error: 'Add an item to your cart first.' });
        const next = { ...sold };
        for (const line of lines) next[line.id] += line.quantity;
        try { persist(next); } catch (err) { console.error('Could not save inventory:', err.message); return respond({ ok: false, error: 'Could not save this order. Your items are still reserved; please try again.' }); }
        Object.assign(sold, next);
        shopper.cart = {}; shopper.expiresAt = null;
        const order = { id: randomUUID().slice(0, 8).toUpperCase(), lines, total: lines.reduce((n, l) => n + l.price * l.quantity, 0) };
        log(`${lines.reduce((n, l) => n + l.quantity, 0)} item(s) checked out. Another good hand.`);
        privateState(socket, shopper); broadcast(); respond({ ok: true, order }); return;
      }
      const product = catalog.find(p => p.id === action.id);
      if (!product || !['reserve', 'release'].includes(action.type)) return respond({ ok: false, error: 'Unknown product or action.' });
      if (action.type === 'reserve') {
        if (available(product.id) <= 0) return respond({ ok: false, error: 'That item was just reserved by another shopper.' });
        shopper.cart[product.id] = (shopper.cart[product.id] || 0) + 1;
        if (!shopper.expiresAt) shopper.expiresAt = now + leaseMs;
        log(`${product.name} reserved. ${available(product.id)} available.`);
      } else {
        if (!shopper.cart[product.id]) return respond({ ok: false, error: 'This item is not in your cart.' });
        if (--shopper.cart[product.id] === 0) delete shopper.cart[product.id];
        if (!Object.keys(shopper.cart).length) shopper.expiresAt = null;
        log(`${product.name} returned to the drop.`);
      }
      privateState(socket, shopper); broadcast(); respond({ ok: true });
    });
    socket.on('disconnect', () => {
      shoppers.delete(socket.id);
      if (Object.keys(shopper.cart).length) log('A shopper left. Their reserved items are available again.');
      broadcast();
    });
  });
  const interval = setInterval(() => { for (const [id, s] of shoppers) { const socket = io.sockets.sockets.get(id); if (socket) expire(socket, s); } }, Math.min(1000, leaseMs));
  interval.unref();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'" });
    next();
  });
  app.get('/health', (req, res) => res.json({ ok: true, online: shoppers.size }));
  app.use(express.static(join(root, 'public')));
  return { server, io, state, close: () => new Promise(resolve => { clearInterval(interval); io.close(() => server.close(() => resolve())); }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const store = createStore();
  const port = Number(process.env.PORT || 3000);
  store.server.listen(port, '0.0.0.0', () => console.log(`The Poker Drop is running at http://localhost:${port}`));
}
