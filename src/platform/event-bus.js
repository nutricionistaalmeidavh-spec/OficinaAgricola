import { assertDomainEvent } from './events.js';

export class EventBus {
  #handlers = new Map();

  subscribe(type, handler) {
    if (typeof type !== 'string' || !type.trim()) throw new TypeError('Tipo de assinatura inválido');
    if (typeof handler !== 'function') throw new TypeError('Handler inválido');
    const key = type.trim();
    const handlers = this.#handlers.get(key) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(key, handlers);
    return () => {
      const current = this.#handlers.get(key);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.#handlers.delete(key);
    };
  }

  async publish(event) {
    assertDomainEvent(event);
    const handlers = [
      ...(this.#handlers.get(event.type) ?? []),
      ...(this.#handlers.get('*') ?? [])
    ];
    for (const handler of handlers) await handler(event);
    return handlers.length;
  }
}
