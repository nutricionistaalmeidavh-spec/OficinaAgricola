import { randomUUID } from 'node:crypto';

export const DOMAIN_EVENT_TYPES = Object.freeze({
  WORK_ORDER_CREATED: 'WORK_ORDER_CREATED',
  WORK_ORDER_STATUS_CHANGED: 'WORK_ORDER_STATUS_CHANGED',
  QUOTE_APPROVED: 'QUOTE_APPROVED',
  INVENTORY_MOVED: 'INVENTORY_MOVED',
  PAYMENT_REGISTERED: 'PAYMENT_REGISTERED',
  SALE_COMPLETED: 'SALE_COMPLETED',
  SALE_CANCELLED: 'SALE_CANCELLED',
  CASH_OPENED: 'CASH_OPENED',
  CASH_MOVED: 'CASH_MOVED',
  CASH_CLOSED: 'CASH_CLOSED',
  ENTITY_MUTATED: 'ENTITY_MUTATED'
});

/**
 * @typedef {object} DomainEvent
 * @property {string} eventId
 * @property {string} type
 * @property {string} occurredAt
 * @property {string|null} actorId
 * @property {string|null} correlationId
 * @property {Record<string, unknown>} payload
 */

export function createDomainEvent(type, payload = {}, meta = {}) {
  if (typeof type !== 'string' || !type.trim()) throw new TypeError('Tipo de evento inválido');
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Payload de evento inválido');
  return Object.freeze({
    eventId: meta.eventId ?? randomUUID(),
    type: type.trim(),
    occurredAt: meta.occurredAt ?? new Date().toISOString(),
    actorId: meta.actorId ?? null,
    correlationId: meta.correlationId ?? null,
    payload: Object.freeze({ ...payload })
  });
}

export function assertDomainEvent(event) {
  if (!event || typeof event !== 'object') throw new TypeError('Evento inválido');
  if (typeof event.eventId !== 'string' || !event.eventId) throw new TypeError('eventId inválido');
  if (typeof event.type !== 'string' || !event.type) throw new TypeError('type inválido');
  if (typeof event.occurredAt !== 'string' || Number.isNaN(Date.parse(event.occurredAt))) throw new TypeError('occurredAt inválido');
  if (event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new TypeError('payload inválido');
  return event;
}
