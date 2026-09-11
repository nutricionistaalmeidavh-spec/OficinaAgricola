# OficinaAgro Fundação 08 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar EventBus, auditoria, backup/restauração, jobs locais e base LAN/PWA sem alterar regras de negócio existentes.

**Architecture:** Módulos isolados em `src/platform`, apenas Node.js core. Um launcher separado ativa LAN sem reescrever `server.js`; o domínio atual permanece intacto.

**Tech Stack:** Node.js 22, ESM, `node:test`, APIs nativas `fs`, `crypto` e `os`.

**Spec:** `docs/superpowers/specs/2026-09-11-oficina-agro-fundacao-08-design.md`

## Global Constraints
- Core R$ 0, self-hosted e open source.
- Sem dependências externas obrigatórias.
- Sem compra inteligente, fiscal ou notificações internas.
- Não alterar regras de OS/estoque/financeiro nesta etapa.

---

### Task 1: EventBus e contratos
**Files:** `src/platform/events.js`, `src/platform/event-bus.js`, `tests/platform-foundation.test.js`
- [x] Testar publicação, assinatura e unsubscribe.
- [x] Implementar contratos/event bus sem dependência externa.

### Task 2: Auditoria
**Files:** `src/platform/audit-log.js`, `tests/platform-foundation.test.js`
- [x] Testar persistência JSONL via curinga do EventBus.
- [x] Implementar append-only e leitura.

### Task 3: Backup/restauração
**Files:** `src/platform/backup.js`, `tests/platform-foundation.test.js`
- [x] Testar cópia, manifesto/checksum e restauração.
- [x] Testar rejeição de corrupção.

### Task 4: Jobs locais
**Files:** `src/platform/job-queue.js`, `tests/platform-foundation.test.js`
- [x] Testar FIFO, tamanho e `drain()`.
- [x] Implementar fila sequencial local.

### Task 5: LAN/PWA
**Files:** `src/platform/network.js`, `src/start.js`, `public/manifest.webmanifest`, `public/icon.svg`, `public/sw.js`, `public/pwa-register.js`, `public/index.html`, `.env.example`, `package.json`
- [x] Configurar launcher para `0.0.0.0` por padrão.
- [x] Exibir URLs LAN disponíveis.
- [x] Adicionar PWA sem cache de API.

### Task 6: Gate
- [x] Testes isolados da Fundação 08 executados localmente.
- [x] Sintaxe dos novos módulos validada localmente.
- [ ] CI GitHub: indisponível como gate enquanto os jobs do repositório falham antes de executar etapas, inclusive na baseline.
