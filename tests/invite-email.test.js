'use strict';
// Version 1.5: sharing with an address that has no Google Account sends Drive's invite email for that address only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./harness');

const NO_ACCOUNT = 'API call to drive.permissions.create failed with error: Bad Request. User message: "You are trying to invite a@b.org. As there is no Google Account associated with this email address, you must tick the "Notify people" box to invite this recipient."';
function setup(config, behaviour) {
  const calls = [], logged = [];
  const p = loadProject({ Drive: { Permissions: { create: (body, id, options) => { calls.push(options.sendNotificationEmail); return behaviour(options); } } } });
  p.override('permissionForUser_', () => null);
  p.override('writeException_', e => logged.push(e));
  return { p, calls, logged, share: () => p.get('ensureUserRole_')('F1', 'a@b.org', 'writer', config) };
}

test('silent share works for a Google address: one call, no invite email, nothing logged', () => {
  const t = setup({ SEND_SHARING_NOTIFICATION: 'No' }, () => ({ id: 'p1' }));
  t.share();
  assert.deepEqual(t.calls, [false]);
  assert.equal(t.logged.length, 0);
});

test('an address without a Google Account is retried once with the invite email and logged', () => {
  const t = setup({ SEND_SHARING_NOTIFICATION: 'No' }, o => { if (!o.sendNotificationEmail) throw new Error(NO_ACCOUNT); return { id: 'p2' }; });
  assert.equal(t.share().id, 'p2');
  assert.deepEqual(t.calls, [false, true]);
  assert.equal(t.logged.length, 1);
  assert.match(t.logged[0].message, /a@b\.org/);
});

test('other Drive errors are not retried', () => {
  const t = setup({ SEND_SHARING_NOTIFICATION: 'No' }, () => { throw new Error('Rate limit exceeded'); });
  assert.throws(() => t.share(), /Rate limit/);
  assert.deepEqual(t.calls, [false]);
});

test('with SEND_SHARING_NOTIFICATION = Yes behaviour is unchanged and a failure is not retried', () => {
  const t = setup({ SEND_SHARING_NOTIFICATION: 'Yes' }, () => { throw new Error(NO_ACCOUNT); });
  assert.throws(() => t.share(), /no Google Account/);
  assert.deepEqual(t.calls, [true]);
});

test('a failing log line does not undo a successful share', () => {
  const t = setup({ SEND_SHARING_NOTIFICATION: 'No' }, o => { if (!o.sendNotificationEmail) throw new Error(NO_ACCOUNT); return { id: 'p3' }; });
  t.p.override('writeException_', () => { throw new Error('log down'); });
  assert.equal(t.share().id, 'p3');
});
