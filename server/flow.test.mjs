import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {createApp} from './index.mjs';

test('dispatch, reservation, cancellation, delivery and confirmed top-up', async t => {
  const server = createApp();
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    await closed;
  });
  function call(role, action, changes = {}) {
    const request = Readable.from(action ? [Buffer.from(JSON.stringify({action, ...changes}))] : []);
    request.method = action ? 'POST' : 'GET';
    request.url = '/api/state';
    request.headers = {authorization: 'Bearer demo-' + role};
    return new Promise(resolve => {
      server.emit('request', request, {
        writeHead(status) {
          return {end: body => resolve({status, data: JSON.parse(body)})};
        },
      });
    });
  }
  const create = requestId => call('store', 'create', {requestId, address: 'شارع الاختبار', lat: 31.95, lng: 35.92});
  const accept = (role, orderId) => call(role, 'accept', {orderId});
  await create('order-1');
  await create('order-1');
  assert.equal((await call('store')).data.orders.length, 1);
  assert.equal((await call('driver')).data.offers[0].address, undefined);
  const candidates = ['driver', 'driver2'];
  const results = await Promise.all(candidates.map(role => accept(role, 'order-1')));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = candidates[results.findIndex(result => result.status === 200)];
  const loser = candidates.find(role => role !== winner);
  assert.deepEqual((await call(winner)).data.wallet, {available: 250, reserved: 250});
  assert.equal((await call(winner)).data.orders[0].address, 'شارع الاختبار');

  await create('order-2');
  assert.equal((await accept(winner, 'order-2')).status, 409);
  assert.equal((await call('store', 'cancel', {orderId: 'order-1'})).status, 200);
  assert.deepEqual((await call(winner)).data.wallet, {available: 500, reserved: 0});

  await call(loser, 'presence', {lat: 32.02, lng: 35.91, available: true});
  assert.equal((await call(loser)).data.offers.length, 0);
  assert.equal((await accept(loser, 'order-2')).status, 409);
  assert.equal((await call('admin', 'assign', {orderId: 'order-2', driver: winner})).status, 200);
  assert.equal((await accept(winner, 'order-2')).status, 200);
  for (const status of ['arrived', 'picked_up', 'delivered', 'delivered']) {
    assert.equal((await call(winner, 'advance', {orderId: 'order-2', status})).status, 200);
  }
  let state = (await call(winner)).data;
  assert.deepEqual(state.wallet, {available: 250, reserved: 0});
  assert.deepEqual(state.ledger.map(entry => entry.amount), [-250]);

  await create('order-3');
  await accept(winner, 'order-3');
  for (const status of ['arrived', 'picked_up', 'delivered']) {
    await call(winner, 'advance', {orderId: 'order-3', status});
  }
  await create('order-4');
  assert.equal((await accept(winner, 'order-4')).status, 409);
  await call('admin', 'topup', {requestId: 'top-1', driver: winner, amount: 1000});
  assert.equal((await call(winner)).data.wallet.available, 0);
  assert.equal((await call(loser, 'confirm', {topupId: 'top-1'})).status, 404);
  await call(winner, 'confirm', {topupId: 'top-1'});
  state = (await call(winner, 'confirm', {topupId: 'top-1'})).data;
  assert.deepEqual(state.wallet, {available: 1000, reserved: 0});
  assert.equal(state.ledger.filter(entry => entry.topup === 'top-1').length, 1);
  assert.equal((await accept(winner, 'order-4')).status, 200);
});
