import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertDomainEvent } from './events.js';

export class AuditLog {
  constructor({ filePath }) {
    if (typeof filePath !== 'string' || !filePath) throw new TypeError('filePath obrigatório');
    this.filePath = filePath;
    // A autoridade da auditoria é o outbox SQLite; JSONL é uma projeção local.
    // Replays após falha de uma integração não devem duplicar esta projeção.
    this.seenIds = new Set();
    if (existsSync(filePath)) {
      for (const line of readFileSync(filePath,'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const event=JSON.parse(line); if(event.eventId)this.seenIds.add(event.eventId); }
        catch { /* Uma linha inválida não apaga o histórico existente. */ }
      }
    }
  }

  append(event) {
    assertDomainEvent(event);
    if(this.seenIds.has(event.eventId))return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
    this.seenIds.add(event.eventId);
  }

  attach(bus) {
    if (!bus || typeof bus.subscribe !== 'function') throw new TypeError('EventBus inválido');
    return bus.subscribe('*', event => this.append(event));
  }

  readAll() {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
}
