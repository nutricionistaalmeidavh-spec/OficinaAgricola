# OficinaAgro Fundação 08 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar EventBus, auditoria, backup/restauração, jobs locais e base LAN/PWA sem alterar regras de negócio existentes.

**Architecture:** Módulos isolados em `src/platform`, apenas Node.js core. Integração visual restrita a PWA; o domínio atual permanece intacto.

**Tech Stack:** Node.js 22, ESM, `node:test`, APIs nativas `fs`, `crypto`, `os` e `events` quando necessário.

**Spec:** `docs/superpowers/specs/2026-09-11-oficina-agro-fundacao-08-design.md`

## Global Constraints

- Core R$ 0, self-hosted e open source.
- Sem dependências externas obrigatórias.
- Sem compra inteligente, fiscal ou notificações internas.
- Não alterar comportamento de OS/estoque/financeiro nesta etapa.

---

### Task 1: Contratos + EventBus

**Files:**
- Create: `src/platform/events.js`
- Create: `src/platform/event-bus.js`
- Test: `tests/platform-foundation.test.js`

- [ ] Escrever teste de publicação/assinatura/desassinatura.
- [ ] Verificar RED.
- [ ] Implementar contrato e EventBus mínimos.
- [ ] Verificar GREEN.

### Task 2: Auditoria local

**Files:**
- Create: `src/platform/audit-log.js`
- Test: `tests/platform-foundation.test.js`

- [ ] Testar persistência JSONL via EventBus.
- [ ] Implementar append-only e leitura.
- [ ] Verificar GREEN.

### Task 3: Backup e restauração

**Files:**
- Create: `src/platform/backup.js`
- Test: `tests/platform-foundation.test.js`

- [ ] Testar cópia, manifesto/checksum e restauração.
- [ ] Testar rejeição de backup corrompido.
- [ ] Implementar somente com Node.js core.
- [ ] Verificar GREEN.

### Task 4: Jobs locais

**Files:**
- Create: `src/platform/job-queue.js`
- Test: `tests/platform-foundation.test.js`

- [ ] Testar FIFO e `drain()`.
- [ ] Implementar fila sequencial local.
- [ ] Verificar GREEN.

### Task 5: LAN/PWA

**Files:**
- Create: `src/platform/network.js`
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Create: `public/pwa-register.js`
- Modify: `public/index.html`
- Test: `tests/e2e.test.js`

- [ ] Testar host/porta e descoberta IPv4 LAN.
- [ ] Testar presença do manifesto e que service worker exclui `/api/` do cache.
- [ ] Adicionar PWA sem alterar fluxo de telas.
- [ ] Verificar GREEN.

### Task 6: Gate de regressão

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] Integrar somente com todos os gates verdes.
