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

  #handlersFor(type) {
    return [...(this.#handlers.get(type) ?? []), ...(this.#handlers.get('*') ?? [])];
  }

  async publishSettled(event) {
    assertDomainEvent(event);
    const handlers = this.#handlersFor(event.type);
    const settled = await Promise.allSettled(handlers.map(handler => {
      try { return Promise.resolve(handler(event)); }
      catch (error) { return Promise.reject(error); }
    }));
    return {
      handled: handlers.length,
      errors: settled.filter(item => item.status === 'rejected').map(item => item.reason),
    };
  }

  async publish(event) {
    const result = await this.publishSettled(event);
    if (result.errors.length) throw result.errors[0];
    return result.handled;
  }
}
