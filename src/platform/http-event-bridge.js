import { DOMAIN_EVENT_TYPES } from './events.js';

const MAX_CAPTURE_BYTES = 512 * 1024;

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function describeHttpMutation(method, pathname, data = {}) {
  const verb = String(method || '').toUpperCase();
  const path = String(pathname || '');
  let match;

  if (verb === 'POST' && path === '/api/work-orders') {
    return {
      type: DOMAIN_EVENT_TYPES.WORK_ORDER_CREATED,
      payload: { workOrderId: data.id ?? null, osNumber: data.os_number ?? null, status: data.status ?? null },
      meta: { correlationId: data.id ? `work-order:${data.id}` : null },
    };
  }
  if (verb === 'POST' && (match = path.match(/^\/api\/work-orders\/(\d+)\/status$/))) {
    return {
      type: DOMAIN_EVENT_TYPES.WORK_ORDER_STATUS_CHANGED,
      payload: { workOrderId: Number(match[1]), status: data.status ?? null },
      meta: { correlationId: `work-order:${match[1]}` },
    };
  }
  if (verb === 'POST' && (match = path.match(/^\/api\/work-orders\/(\d+)\/quote\/approve$/))) {
    return {
      type: DOMAIN_EVENT_TYPES.QUOTE_APPROVED,
      payload: { workOrderId: Number(match[1]), quoteId: data.id ?? null, totalCents: data.total_cents ?? null },
      meta: { correlationId: `work-order:${match[1]}` },
    };
  }
  if (verb === 'POST' && path === '/api/inventory/movements') {
    return {
      type: DOMAIN_EVENT_TYPES.INVENTORY_MOVED,
      payload: {
        movementId: data.id ?? null,
        partId: data.part_id ?? data.partId ?? null,
        movementType: data.type ?? null,
        quantity: asNumber(data.quantity),
      },
      meta: { correlationId: data.part_id || data.partId ? `part:${data.part_id ?? data.partId}` : null },
    };
  }
  if (verb === 'POST' && (match = path.match(/^\/api\/work-orders\/(\d+)\/parts$/))) {
    return {
      type: DOMAIN_EVENT_TYPES.INVENTORY_MOVED,
      payload: {
        workOrderId: Number(match[1]),
        workOrderPartId: data.id ?? null,
        partId: data.part_id ?? data.partId ?? null,
        movementType: 'CONSUMO_OS',
        quantity: asNumber(data.quantity),
      },
      meta: { correlationId: `work-order:${match[1]}` },
    };
  }
  if (verb === 'POST' && (match = path.match(/^\/api\/work-orders\/(\d+)\/receipts$/))) {
    return {
      type: DOMAIN_EVENT_TYPES.PAYMENT_REGISTERED,
      payload: {
        workOrderId: Number(match[1]),
        receiptId: data.id ?? null,
        amountCents: data.amount_cents ?? data.amountCents ?? null,
        method: data.method ?? null,
      },
      meta: { correlationId: `work-order:${match[1]}` },
    };
  }
  if (verb === 'POST' && path === '/api/sales') {
    return {
      type: DOMAIN_EVENT_TYPES.SALE_COMPLETED,
      payload: { saleId: data.id ?? null, totalCents: data.total_cents ?? null, paymentMethod: data.payment_method ?? null },
      meta: { correlationId: data.id ? `sale:${data.id}` : null },
    };
  }
  if (verb === 'POST' && (match = path.match(/^\/api\/sales\/(\d+)\/cancel$/))) {
    return {
      type: DOMAIN_EVENT_TYPES.SALE_CANCELLED,
      payload: { saleId: Number(match[1]), status: data.status ?? null },
      meta: { correlationId: `sale:${match[1]}` },
    };
  }
  if (verb === 'POST' && path === '/api/cash/open') {
    return {
      type: DOMAIN_EVENT_TYPES.CASH_OPENED,
      payload: { cashSessionId: data.id ?? null, openingCents: data.opening_cents ?? null },
      meta: { correlationId: data.id ? `cash:${data.id}` : null },
    };
  }
  if (verb === 'POST' && path === '/api/cash/current/movements') {
    return {
      type: DOMAIN_EVENT_TYPES.CASH_MOVED,
      payload: { cashMovementId: data.id ?? null, type: data.type ?? null, amountCents: data.amount_cents ?? null },
      meta: { correlationId: data.cash_session_id ? `cash:${data.cash_session_id}` : null },
    };
  }
  if (verb === 'POST' && path === '/api/cash/current/close') {
    return {
      type: DOMAIN_EVENT_TYPES.CASH_CLOSED,
      payload: { cashSessionId: data.id ?? null, closingCents: data.closing_cents ?? null, differenceCents: data.difference_cents ?? null },
      meta: { correlationId: data.id ? `cash:${data.id}` : null },
    };
  }
  return null;
}

function parseCapturedJson(chunks) {
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

export function attachHttpEventBridge({ req, res, eventRuntime, logger = console }) {
  if (!eventRuntime || typeof eventRuntime.emit !== 'function') return false;
  const method = req.method || 'GET';
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (!describeHttpMutation(method, pathname, {})) return false;

  const chunks = [];
  let bytes = 0;
  const capture = chunk => {
    if (chunk == null || bytes >= MAX_CAPTURE_BYTES) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const remaining = MAX_CAPTURE_BYTES - bytes;
    chunks.push(buffer.subarray(0, remaining));
    bytes += Math.min(buffer.length, remaining);
  };

  const originalWrite = res.write;
  const originalEnd = res.end;
  res.write = function (...args) {
    capture(args[0]);
    return originalWrite.apply(this, args);
  };
  res.end = function (...args) {
    capture(args[0]);
    const result = originalEnd.apply(this, args);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const descriptor = describeHttpMutation(method, pathname, parseCapturedJson(chunks));
      if (descriptor) {
        Promise.resolve(eventRuntime.emit(descriptor.type, descriptor.payload, descriptor.meta)).catch(error => {
          logger?.error?.('[http-event-bridge]', descriptor.type, error?.message || String(error));
        });
      }
    }
    return result;
  };
  return true;
}
