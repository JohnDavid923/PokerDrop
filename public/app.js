/* Every inventory mutation is acknowledged by the server. Stock is never changed optimistically. */
const socket = io({ transports: ['websocket'] });
const $ = id => document.getElementById(id);
let store = null, cart = {}, expiresAt = null, filter = 'All', pending = false, connected = false;
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const shapes = {
  tee: '<path d="M78 34 45 53 23 93 55 109 69 88 67 193 173 193 171 88 185 109 217 93 195 53 162 34Q120 62 78 34Z"/><path d="M99 41Q120 68 141 41" fill="none" stroke="#ffffff33" stroke-width="5"/><text x="120" y="111" font-size="29" fill="#e4d8af">♠</text><text x="120" y="128" font-size="7" fill="#e4d8af" letter-spacing="1">THE POKER DROP</text>',
  hoodie: '<path d="M87 49Q82 9 120 8 158 9 153 49L183 66 210 176 179 185 162 128 166 210 74 210 78 128 61 185 30 176 57 66Z"/><path d="M87 49 120 70 153 49Q150 22 120 21 90 22 87 49" fill="#8f8879"/><path d="M104 66 101 112M136 66 139 112M94 162 86 187 154 187 146 162" stroke="#ded6c2" stroke-width="2" fill="none"/><text x="120" y="132" font-size="24" fill="#f2ecd9">♠</text>',
  cap: '<path d="M57 136Q51 56 123 52 184 54 186 137Z"/><path d="M57 136Q128 121 186 137L224 166Q153 193 77 159Z" fill="#383e36"/><path d="M122 53Q104 88 108 130M122 53Q150 86 156 131" fill="none" stroke="#ffffff18" stroke-width="2"/><ellipse cx="123" cy="52" rx="7" ry="3" fill="#3e443b"/><text x="119" y="111" font-size="22" fill="#dfd9bc">♠</text><text x="118" y="123" font-size="6" fill="#dfd9bc" letter-spacing="2">ALL IN</text>',
  protector: '<circle cx="120" cy="117" r="73" fill="#a48b52"/><circle cx="120" cy="111" r="73"/><circle cx="120" cy="111" r="62" fill="none" stroke="#90753e" stroke-width="2"/><circle cx="120" cy="111" r="56" fill="none" stroke="#efe1b4" stroke-width="1"/><text x="120" y="134" font-size="80" fill="#384a35">♠</text><text x="120" y="71" font-size="7" fill="#746030" letter-spacing="2">THE LUCKY SPADE</text><text x="120" y="156" font-size="7" fill="#746030" letter-spacing="2">GOOD HANDS AHEAD</text>',
  chips: '<rect x="25" y="66" width="190" height="119" rx="10" fill="#303b33"/><rect x="30" y="70" width="180" height="108" rx="6" fill="#4e5d4d"/><path d="M25 113H215" stroke="#bfc2ac" stroke-width="4"/><rect x="95" y="56" width="50" height="12" rx="4" fill="none" stroke="#7d8776" stroke-width="5"/><rect x="63" y="106" width="17" height="14" rx="2" fill="#c3c5ae"/><rect x="160" y="106" width="17" height="14" rx="2" fill="#c3c5ae"/><g stroke="#ede2bc" stroke-width="4" stroke-dasharray="7 7"><ellipse cx="69" cy="184" rx="33" ry="13" fill="#9e4c3b"/><ellipse cx="69" cy="176" rx="33" ry="13" fill="#9e4c3b"/><ellipse cx="69" cy="168" rx="33" ry="13" fill="#9e4c3b"/><ellipse cx="151" cy="194" rx="34" ry="14" fill="#294a3b"/><ellipse cx="151" cy="186" rx="34" ry="14" fill="#294a3b"/><ellipse cx="151" cy="178" rx="34" ry="14" fill="#294a3b"/></g><text x="151" y="182" font-size="14" fill="#ede2bc">♠</text>',
  cards: '<g transform="rotate(-14 120 110)"><rect x="62" y="27" width="108" height="171" rx="7" fill="#d7d7c4"/><rect x="66" y="23" width="108" height="171" rx="7" fill="#fffbed"/><rect x="73" y="30" width="94" height="157" rx="3"/><path d="m78 35 84 147m0-147-84 147M120 34v148M78 108h84" stroke="#ffffff22" stroke-width="1"/><rect x="80" y="37" width="80" height="143" rx="3" stroke="#ecdab1" fill="none"/><circle cx="120" cy="107" r="31" fill="none" stroke="#e8d6ac"/><text x="120" y="122" font-size="45" fill="#ead9b2">♠</text></g><g transform="rotate(14 120 110)"><rect x="100" y="55" width="108" height="151" rx="6" fill="#fffcf1" stroke="#dedbca"/><text x="115" y="77" font-size="17" fill="#253f31">A</text><text x="115" y="96" font-size="19" fill="#253f31">♠</text><text x="156" y="158" font-size="62" fill="#253f31">♠</text></g>'
};
function art(p) { return `<svg viewBox="0 0 240 230" role="img" aria-label="${p.name}" fill="${p.color}" text-anchor="middle" font-family="Georgia,serif">${shapes[p.type]}</svg>`; }
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(window.toastTimeout); window.toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 4500); }
function renderProducts() {
  if (!store) return;
  const focused = document.activeElement?.dataset.add;
  $('products').innerHTML = store.products.filter(p => filter === 'All' || p.category === filter).map(p => `<article class="product"><div class="product-art">${art(p)}<span class="product-tag">${p.available === 0 ? 'FULLY CLAIMED' : p.id === 'tee' ? 'HOUSE FAVORITE' : p.available <= 5 ? 'LIMITED DROP' : 'THE ORIGINALS'}</span></div><div class="product-type">${p.category}</div><div class="product-title"><h3>${p.name}</h3><span class="price">${money(p.price)}</span></div><p class="product-detail">${p.detail}</p><p class="product-description">${p.description}</p><div class="product-bottom"><span class="stock ${p.available === 0 ? 'out' : p.available <= 5 ? 'low' : ''}"><span class="dot"></span>${p.available ? p.available + ' available' : 'Unavailable'}</span><button class="add-button" data-add="${p.id}" aria-label="Add ${p.name} to cart" ${!connected || pending || p.available === 0 ? 'disabled' : ''}>${p.available ? 'Add to cart <span>+</span>' : 'All claimed'}</button></div></article>`).join('');
  $('products').setAttribute('aria-busy', 'false');
  if (focused) document.querySelector(`[data-add="${focused}"]`)?.focus({ preventScroll: true });
}
function renderCart() {
  if (!store) return;
  const rows = store.products.filter(p => cart[p.id]);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  $('cart-count').textContent = count;
  $('cart-label').textContent = `${count} item${count === 1 ? '' : 's'}`;
  $('cart-items').innerHTML = rows.length ? rows.map(p => `<div class="cart-row">${art(p)}<div><h4>${p.name}</h4><div class="cart-controls"><button data-release="${p.id}" aria-label="Remove one ${p.name}" ${!connected || pending ? 'disabled' : ''}>−</button><span aria-label="Quantity">${cart[p.id]}</span><button data-add="${p.id}" aria-label="Add one ${p.name}" ${!connected || pending || !p.available ? 'disabled' : ''}>+</button><span class="line-price">${money(p.price * cart[p.id])}</span></div></div></div>`).join('') : '<div class="empty-cart"><span>♧</span><p>Your next good hand starts here.</p><small>Add something from the drop.</small></div>';
  $('subtotal').textContent = money(rows.reduce((n, p) => n + p.price * cart[p.id], 0));
  $('checkout').disabled = !connected || pending || !count;
  $('reservation').hidden = !expiresAt;
  updateTimer();
}
function updateTimer() {
  if (!expiresAt) return;
  const sec = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  $('timer').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
setInterval(updateTimer, 1000);
function renderActivity() {
  const list = $('activity'); list.replaceChildren();
  if (!store.activity.length) { const li = document.createElement('li'); li.className = 'quiet'; li.textContent = 'The table is open. Make the first move.'; list.append(li); }
  for (const item of store.activity) { const li = document.createElement('li'); li.textContent = item.message; const time = document.createElement('time'); time.dateTime = new Date(item.at).toISOString(); time.textContent = new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); li.append(time); list.append(li); }
}
function connection() {
  $('connection').classList.toggle('offline', !connected);
  $('connection-text').textContent = connected && store ? `${store.online} at the table · Live` : 'Reconnecting…';
  renderProducts(); renderCart();
}
socket.on('connect', () => { connected = true; connection(); });
socket.on('disconnect', () => { connected = false; cart = {}; expiresAt = null; connection(); toast('Connection lost. Your cart has been released. Reconnecting…'); });
socket.on('connect_error', () => { connected = false; connection(); if (!store) { $('products').innerHTML = '<p class="loading">The table is temporarily offline. We’re trying to reconnect…</p>'; $('products').setAttribute('aria-busy', 'false'); } });
socket.on('store', next => { store = next; connection(); renderActivity(); });
socket.on('cart', next => { cart = next.items; expiresAt = next.expiresAt; renderCart(); });
socket.on('notice', toast);
async function action(type, id) {
  if (!connected || pending) return;
  pending = true; renderProducts(); renderCart();
  try {
    const result = await socket.timeout(8000).emitWithAck('action', { type, id });
    if (!result.ok) toast(result.error);
    else if (result.order) showReceipt(result.order);
    else if (type === 'reserve') toast('Added to your hand. Stock updated for everyone.');
  } catch { toast('Could not confirm that action. Check your cart before trying again.'); }
  finally { pending = false; renderProducts(); renderCart(); }
}
document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]'), release = e.target.closest('[data-release]');
  if (add && !add.disabled) action('reserve', add.dataset.add);
  if (release && !release.disabled) action('release', release.dataset.release);
});
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(other => { const active = other === b; other.classList.toggle('active', active); other.setAttribute('aria-pressed', active); });
  renderProducts();
}));
$('checkout').addEventListener('click', () => action('checkout'));
$('cart-link').addEventListener('click', () => { $('cart-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); $('cart-panel').focus({ preventScroll: true }); });
function showReceipt(order) {
  const container = $('receipt-details'); container.replaceChildren();
  const number = document.createElement('p'); number.textContent = `DEMO ORDER #${order.id}`; container.append(number);
  for (const line of order.lines) { const p = document.createElement('p'); const label = document.createElement('span'); label.textContent = `${line.quantity} × ${line.name}`; const price = document.createElement('span'); price.textContent = money(line.quantity * line.price); p.append(label, price); container.append(p); }
  const total = document.createElement('p'); total.textContent = `Demo total: ${money(order.total)}`; container.append(total);
  $('receipt').showModal();
}
$('close-receipt').addEventListener('click', () => $('receipt').close());
$('keep-shopping').addEventListener('click', () => $('receipt').close());
