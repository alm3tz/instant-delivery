export const fee = 250;
const active = ['accepted', 'arrived', 'picked_up'];
const step = {accepted: 'arrived', arrived: 'picked_up', picked_up: 'delivered'};

export function initialState() {
  return {
    store: {name: 'محل تجريبي', lat: 31.9539, lng: 35.9106},
    drivers: [
      {id: 'driver', name: 'كابتن أحمد', lat: 31.964, lng: 35.91, available: true, updated: Date.now(), balance: 500},
      {id: 'driver2', name: 'كابتن عمر', lat: 31.97, lng: 35.92, available: true, updated: Date.now(), balance: 500},
    ],
    orders: [], topups: [], ledger: [], support: '',
  };
}

export function distance(a, b) {
  const radians = Math.PI / 180;
  const chord = Math.sin((b.lat - a.lat) * radians / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians)
    * Math.sin((b.lng - a.lng) * radians / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, chord)));
}

const current = (s, id) => s.orders.find(o => o.driver === id && active.includes(o.status));
const reserved = (s, id) => current(s, id) ? fee : 0;
const recent = d => Date.now() - d.updated < 120000;
const eligible = (s, d) => d.available && recent(d) && distance(d, s.store) < 5 && !current(s, d.id) && d.balance >= fee;
const eta = (s, d) => d && recent(d) ? Math.max(1, Math.ceil(distance(d, s.store) * 3)) : null;

function check(condition, message, status = 409) {
  if (!condition) throw Object.assign(new Error(message), {status});
}

export function view(s, id) {
  const driver = s.drivers.find(d => d.id === id);
  const decorate = o => {
    const assigned = s.drivers.find(d => d.id === o.driver);
    return {...o, driverName: assigned?.name, eta: active.includes(o.status) ? eta(s, assigned) : null};
  };
  if (id === 'admin') return {
    store: s.store, support: s.support, orders: s.orders.map(decorate), topups: s.topups, ledger: s.ledger,
    drivers: s.drivers.map(d => ({...d, eta: eta(s, d), eligible: eligible(s, d), reserved: reserved(s, d.id)})),
  };
  if (id === 'store') return {store: s.store, support: s.support, orders: s.orders.map(decorate)};
  const orders = s.orders.filter(o => o.driver === id).map(decorate);
  const offers = eligible(s, driver) ? s.orders
    .filter(o => o.status === 'searching' && (!o.offeredTo || o.offeredTo === id))
    .map(o => ({id: o.id, status: o.status, distance: distance(driver, s.store), directed: Boolean(o.offeredTo)})) : [];
  return {
    store: s.store, support: s.support, driver, orders, offers,
    wallet: {available: driver.balance - reserved(s, id), reserved: reserved(s, id)},
    topups: s.topups.filter(t => t.driver === id), ledger: s.ledger.filter(t => t.driver === id),
  };
}

export function act(s, id, input) {
  const {action, orderId} = input;
  const driver = s.drivers.find(d => d.id === id);
  const order = s.orders.find(o => o.id === orderId);
  if (action === 'create' && id === 'store') {
    const address = typeof input.address === 'string' ? input.address.trim() : '';
    check(address && address.length <= 400, 'أدخل عنوان التسليم', 400);
    check(validPoint(input), 'حدد إحداثيات موقع التسليم', 400);
    const requestId = input.requestId;
    check(typeof requestId === 'string' && requestId.length <= 80 && requestId.length > 0, 'معرّف الطلب مطلوب', 400);
    if (!s.orders.some(o => o.id === requestId)) {
      s.orders.unshift({id: requestId, address, lat: input.lat, lng: input.lng, status: 'searching', created: Date.now()});
    }
  } else if (action === 'presence' && driver) {
    check(typeof input.available === 'boolean' && validPoint(input), 'حدّث موقعك أولًا', 400);
    Object.assign(driver, {available: input.available, lat: input.lat, lng: input.lng, updated: Date.now()});
  } else if (action === 'assign' && id === 'admin') {
    const target = s.drivers.find(d => d.id === input.driver);
    check(order?.status === 'searching' && target && eligible(s, target), 'الطلب أو السائق غير متاح');
    order.offeredTo = target.id;
  } else if (action === 'accept' && driver) {
    if (order?.driver === id && active.includes(order.status)) return;
    check(order?.status === 'searching' && (!order.offeredTo || order.offeredTo === id), 'الطلب غير متاح');
    check(eligible(s, driver), 'تحقق من رصيدك وموقعك وحالة توفرك');
    Object.assign(order, {driver: id, status: 'accepted', accepted: Date.now()});
    delete order.offeredTo;
  } else if (action === 'advance' && driver) {
    check(order?.driver === id, 'الطلب غير مسند إليك', 403);
    if (order.status === input.status && Object.values(step).includes(input.status)) return;
    check(Boolean(step[order.status]) && step[order.status] === input.status, 'حالة الطلب تغيّرت');
    order.status = input.status;
    if (input.status === 'delivered') {
      order.delivered = Date.now();
      driver.balance -= fee;
      s.ledger.unshift({driver: id, order: order.id, amount: -fee, time: Date.now()});
    }
  } else if (action === 'cancel' && (id === 'store' || id === 'admin')) {
    check(order && ['searching', 'accepted', 'arrived', 'cancelled'].includes(order.status), 'تعذر إلغاء الطلب في هذه المرحلة');
    order.status = 'cancelled';
  } else if (action === 'release' && (id === 'admin' || (driver && order?.driver === id))) {
    check(order && ['searching', 'accepted', 'arrived'].includes(order.status), 'تعذرت إعادة الطلب للبحث');
    order.status = 'searching';
    delete order.driver;
    delete order.offeredTo;
  } else if (action === 'topup' && id === 'admin') {
    check(s.drivers.some(d => d.id === input.driver), 'السائق غير موجود', 400);
    check(Number.isSafeInteger(input.amount) && input.amount > 0 && input.amount <= 1000000, 'أدخل مبلغًا صحيحًا بالفلس', 400);
    check(typeof input.requestId === 'string' && input.requestId.length > 0 && input.requestId.length <= 80, 'معرّف الشحن مطلوب', 400);
    if (!s.topups.some(t => t.id === input.requestId)) {
      s.topups.unshift({id: input.requestId, driver: input.driver, amount: input.amount, status: 'pending', time: Date.now()});
    }
  } else if (action === 'confirm' && driver) {
    const topup = s.topups.find(t => t.id === input.topupId && t.driver === id);
    check(topup, 'طلب الشحن غير موجود', 404);
    if (topup.status === 'confirmed') return;
    topup.status = 'confirmed';
    driver.balance += topup.amount;
    s.ledger.unshift({driver: id, topup: topup.id, amount: topup.amount, time: Date.now()});
  } else if (action === 'support' && id === 'admin') {
    check(typeof input.phone === 'string' && /^(?:\+?\d{7,15})?$/.test(input.phone), 'أدخل رقم هاتف صالحًا', 400);
    s.support = input.phone;
  } else {
    check(false, 'الإجراء غير مسموح', 403);
  }
}

function validPoint({lat, lng}) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
}
