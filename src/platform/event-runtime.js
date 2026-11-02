import { EventBus } from './event-bus.js';
import { AuditLog } from './audit-log.js';
import { createDomainEvent } from './events.js';

function normalizeIntegration(integration) {
  if (!integration || typeof integration !== 'object') throw new TypeError('Integração inválida');
  if (typeof integration.name !== 'string' || !integration.name.trim()) throw new TypeError('Nome da integração obrigatório');
  if (typeof integration.handle !== 'function') throw new TypeError('Handler da integração obrigatório');
  const types = integration.types == null ? ['*'] : Array.isArray(integration.types) ? integration.types : [integration.types];
  if (!types.length || types.some(type => typeof type !== 'string' || !type.trim())) throw new TypeError('Tipos da integração inválidos');
  return { name: integration.name.trim(), handle: integration.handle, types: types.map(type => type.trim()) };
}

export function createEventRuntime({ auditPath = null, integrations = [], logger = console } = {}) {
  const bus = new EventBus();
  const detach = [];
  const audit = auditPath ? new AuditLog({ filePath: auditPath }) : null;
  if (audit) detach.push(audit.attach(bus));

  for (const candidate of integrations) {
    const integration = normalizeIntegration(candidate);
    for (const type of integration.types) {
      detach.push(bus.subscribe(type, event => integration.handle(event)));
    }
  }

  return {
    bus,
    audit,
    // Usado pelo outbox: só confirma entrega quando todos os handlers concluíram.
    async deliver(event){
      await bus.publish(event);
      return event;
    },
    async emit(type, payload = {}, meta = {}) {
      const event = createDomainEvent(type, payload, meta);
      const result = await bus.publishSettled(event);
      for (const error of result.errors) {
        logger?.error?.('[event-runtime]', type, error?.message || String(error));
      }
      return event;
    },
    close() {
      while (detach.length) detach.pop()?.();
    },
  };
}
