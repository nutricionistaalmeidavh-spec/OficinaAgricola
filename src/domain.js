export const OS_STATUSES = Object.freeze([
  'ENTRADA', 'DIAGNOSTICO', 'ORCAMENTO', 'AGUARDANDO_APROVACAO',
  'APROVADA', 'EM_SERVICO', 'PRONTA', 'ENTREGUE', 'CANCELADA', 'REPROVADA'
]);

const transitions = new Map([
  ['ENTRADA', new Set(['DIAGNOSTICO', 'CANCELADA'])],
  ['DIAGNOSTICO', new Set(['ORCAMENTO', 'CANCELADA'])],
  ['ORCAMENTO', new Set(['AGUARDANDO_APROVACAO', 'APROVADA', 'REPROVADA', 'CANCELADA'])],
  ['AGUARDANDO_APROVACAO', new Set(['APROVADA', 'REPROVADA', 'CANCELADA'])],
  ['APROVADA', new Set(['EM_SERVICO', 'CANCELADA'])],
  ['EM_SERVICO', new Set(['PRONTA', 'CANCELADA'])],
  ['PRONTA', new Set(['ENTREGUE', 'EM_SERVICO'])],
  ['ENTREGUE', new Set()],
  ['CANCELADA', new Set()],
  ['REPROVADA', new Set(['ORCAMENTO', 'CANCELADA'])]
]);

export function assertTransition(from, to) {
  if (!transitions.has(from) || !transitions.has(to) || !transitions.get(from).has(to)) {
    throw new Error(`Transição inválida de ${from} para ${to}`);
  }
  return true;
}

export function calculateQuote(items, discountCents = 0) {
  const subtotalCents = items.reduce((sum, item) => {
    const quantity = Number(item.quantity);
    const unitPriceCents = Number(item.unitPriceCents);
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new Error('Item de orçamento inválido');
    }
    return sum + Math.round(quantity * unitPriceCents);
  }, 0);
  const discount = Number(discountCents || 0);
  if (!Number.isInteger(discount) || discount < 0 || discount > subtotalCents) {
    throw new Error('Desconto inválido');
  }
  return { subtotalCents, discountCents: discount, totalCents: subtotalCents - discount };
}

export function paymentState(totalCents, receivedCents) {
  if (!Number.isInteger(totalCents) || totalCents < 0 || !Number.isInteger(receivedCents) || receivedCents < 0) {
    throw new Error('Valores financeiros inválidos');
  }
  const pendingCents = Math.max(totalCents - receivedCents, 0);
  const status = receivedCents <= 0 ? 'PENDENTE' : pendingCents > 0 ? 'PARCIAL' : 'PAGO';
  return { status, receivedCents, pendingCents };
}

export function asCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Valor monetário inválido');
  return Math.round(n * 100);
}
