import { randomUUID } from 'node:crypto';

export class LocalJobQueue {
  #handlers = new Map();
  #queue = [];
  #running = false;
  #active = 0;
  #drainWaiters = [];
  #errors = [];

  register(type, handler) {
    if (typeof type !== 'string' || !type.trim()) throw new TypeError('Tipo de job inválido');
    if (typeof handler !== 'function') throw new TypeError('Handler de job inválido');
    this.#handlers.set(type.trim(), handler);
  }

  enqueue(type, payload = {}) {
    const handler = this.#handlers.get(type);
    if (!handler) throw new Error(`Job sem handler: ${type}`);
    const job = { id: randomUUID(), type, payload, enqueuedAt: new Date().toISOString() };
    this.#queue.push(job);
    queueMicrotask(() => this.#run());
    return job.id;
  }

  get size() {
    return this.#queue.length + this.#active;
  }

  drain() {
    if (!this.#running && this.#queue.length === 0 && this.#active === 0) return this.#finishDrain();
    return new Promise((resolve, reject) => this.#drainWaiters.push({ resolve, reject }));
  }

  async #run() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#queue.length) {
        const job = this.#queue.shift();
        this.#active = 1;
        try { await this.#handlers.get(job.type)(job.payload, job); }
        catch (error) { this.#errors.push(error); }
        finally { this.#active = 0; }
      }
    } finally {
      this.#running = false;
      const waiters = this.#drainWaiters.splice(0);
      const error = this.#errors.shift();
      this.#errors.length = 0;
      for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve();
    }
  }

  #finishDrain() {
    const error = this.#errors.shift();
    this.#errors.length = 0;
    return error ? Promise.reject(error) : Promise.resolve();
  }
}
