import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertDomainEvent } from './events.js';

export class AuditLog {
  constructor({ filePath }) {
    if (typeof filePath !== 'string' || !filePath) throw new TypeError('filePath obrigatório');
    this.filePath = filePath;
  }

  append(event) {
    assertDomainEvent(event);
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  attach(bus) {
    if (!bus || typeof bus.subscribe !== 'function') throw new TypeError('EventBus inválido');
    return bus.subscribe('*', event => this.append(event));
  }

  readAll() {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }
}
