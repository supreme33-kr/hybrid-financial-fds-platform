import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';

test('POST /api/v1/transactions persists a high amount transaction and detects R02', async (t) => {
  const app = buildApp({ trustProxy: true });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: {
      'x-forwarded-for': '203.0.113.25',
    },
    payload: {
      account_id: 'ACC001',
      amount: 1500000,
      transaction_type: 'WITHDRAWAL',
      event_time: '2026-09-01T01:30:00+09:00',
    },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.account_id, 'ACC001');
  assert.equal(body.source_ip, '203.0.113.25');
  assert.equal(body.fds_detected, true);
  assert.deepEqual(
    body.fds_rules.map((rule) => rule.rule_id).sort(),
    ['R02', 'R04'],
  );

  const getResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/transactions/${body.transaction_id}`,
  });
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json().transaction_id, body.transaction_id);
});

test('POST /api/v1/transactions rejects an untrusted source_ip in the request body', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    payload: {
      account_id: 'ACC001',
      amount: 1500000,
      transaction_type: 'WITHDRAWAL',
      event_time: '2026-09-01T01:30:00+09:00',
      source_ip: '198.51.100.10',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/transactions detects R01 after three withdrawals within 60 seconds', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const firstEventTime = '2026-09-01T12:00:00+09:00';
  for (const eventTime of [
    firstEventTime,
    '2026-09-01T12:00:20+09:00',
    '2026-09-01T12:00:50+09:00',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      payload: {
        account_id: 'ACC777',
        amount: 10000,
        transaction_type: 'WITHDRAWAL',
        event_time: eventTime,
      },
    });

    assert.equal(response.statusCode, 201);
    if (eventTime === '2026-09-01T12:00:50+09:00') {
      assert.ok(
        response.json().fds_rules.some((rule) => rule.rule_id === 'R01'),
      );
    }
  }
});

test('POST /api/v1/fds/check evaluates rules without persisting a transaction', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/fds/check',
    payload: {
      account_id: 'ACC900',
      amount: 1100000,
      transaction_type: 'TRANSFER',
      event_time: '2026-09-01T09:00:00+09:00',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().fds_detected, true);
  assert.ok(response.json().fds_rules.some((rule) => rule.rule_id === 'R02'));
});
