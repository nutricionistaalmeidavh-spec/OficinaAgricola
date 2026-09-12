import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, calculateQuote, paymentState } from '../src/domain.js';

test('allows only declared OS transitions', () => {
  assert.equal(assertTransition('ENTRADA', 'DIAGNOSTICO'), true);
  assert.throws(() => assertTransition('ENTRADA', 'EM_SERVICO'), /Transição inválida/);
});

test('calculates quote totals in cents', () => {
  assert.deepEqual(calculateQuote([
    { quantity: 2, unitPriceCents: 10000 },
    { quantity: 1, unitPriceCents: 5000 }
  ], 1000), { subtotalCents: 25000, discountCents: 1000, totalCents: 24000 });
});

test('classifies payment as pending partial or paid', () => {
  assert.deepEqual(paymentState(10000, 0), { status: 'PENDENTE', receivedCents: 0, pendingCents: 10000 });
  assert.deepEqual(paymentState(10000, 4000), { status: 'PARCIAL', receivedCents: 4000, pendingCents: 6000 });
  assert.deepEqual(paymentState(10000, 10000), { status: 'PAGO', receivedCents: 10000, pendingCents: 0 });
});
