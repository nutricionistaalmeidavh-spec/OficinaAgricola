# Assistência Técnica · Entregas 11–14 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** concluir a edição Assistência Técnica com EventBus realmente conectado às mutações do sistema, regressão/QA própria, build final isolado e entrega v1.0.0 sem gerar instaladores intermediários.

**Architecture:** manter o core local e sem SaaS obrigatório. O `createAssistenciaServer` continua encapsulando o servidor legado e ganha uma ponte HTTP→EventBus que observa somente mutações concluídas com sucesso; o runtime de eventos persiste JSONL local e aceita integrações opcionais sem permitir que falhas externas quebrem a operação. A release final é gerada somente numa branch dedicada `release/assistencia-v1.0.0`.

**Tech Stack:** Node.js 22.16+, SQLite nativo do projeto, HTTP nativo, Electron 43.4.1, electron-builder 26.15.3, Playwright 1.62.1 no QA de CI.

**Spec:** roadmap aprovado em conversa para Entregas 11–14.

## Global Constraints

- Core obrigatório R$0, local e self-hosted.
- Nenhuma API/SaaS externa pode ser dependência silenciosa.
- Porta padrão da Assistência Técnica: `3344`.
- Banco e uploads permanecem locais.
- Não gerar instalador em branch de desenvolvimento ou em `main`.
- Gerar o próximo instalador somente após o merge das entregas finais, na branch `release/assistencia-v1.0.0`.

---

### Task 1: EventBus e integrações locais

**Files:**
- Modify: `apps/assistencia-tecnica/src/platform/event-bus.js`
- Modify: `apps/assistencia-tecnica/src/platform/events.js`
- Create: `apps/assistencia-tecnica/src/platform/event-runtime.js`
- Create: `apps/assistencia-tecnica/src/platform/http-event-bridge.js`
- Modify: `apps/assistencia-tecnica/src/server-assistencia.js`
- Modify: `apps/assistencia-tecnica/src/start.js`
- Test: `apps/assistencia-tecnica/tests/event-integration.test.js`

**Interfaces:**
- Produces `createEventRuntime({ auditPath, integrations, logger })` with `emit(type,payload,meta)` and `close()`.
- Produces `attachHttpEventBridge({ req, res, eventRuntime })` and `describeHttpMutation(method, pathname, data)`.
- `createAssistenciaServer` receives optional `eventRuntime`.

- [ ] Escrever testes de mapeamento HTTP→evento e isolamento de falhas de integração.
- [ ] Confirmar RED.
- [ ] Implementar `publishSettled` no EventBus e runtime local auditável.
- [ ] Conectar a ponte no servidor da assistência e iniciar o runtime em `src/start.js`.
- [ ] Confirmar GREEN.

### Task 2: QA e regressão finais

**Files:**
- Modify: `apps/assistencia-tecnica/qa/artisys-qa.config.json`
- Modify: `.circleci/config.yml`
- Test: `tests/assistencia-final-delivery.test.js`

**Interfaces:**
- `assistencia_quality` executa lint, testes, build e E2E.
- `assistencia_qa` executa desktop e mobile com Playwright local, sem GitHub Actions.

- [ ] Corrigir o cwd do manifest QA para seed e servidor usarem a mesma `.qa/`.
- [ ] Adicionar QA desktop/mobile específico da assistência.
- [ ] Evitar root QA nas branches técnicas da assistência para não desperdiçar minutos.
- [ ] Validar quality + QA da assistência antes do merge.

### Task 3: Build final v1.0.0

**Files:**
- Modify: `apps/assistencia-tecnica/package.json`
- Modify: `apps/assistencia-tecnica/package-lock.json`
- Modify: `.circleci/config.yml`

**Interfaces:**
- Artefato final: `AssistenciaTecnica-ArtiSys-Setup-1.0.0-Windows-x64.exe`.
- `assistencia_windows_build` roda somente em `release/assistencia-v1.0.0` após `assistencia_quality` e QA.

- [ ] Bump para `1.0.0`.
- [ ] Garantir que build Electron final não publique externamente de forma obrigatória.
- [ ] Após merge, criar `release/assistencia-v1.0.0` a partir da `main` para gerar exatamente um instalador final.

### Task 4: Entrega e documentação

**Files:**
- Modify: `apps/assistencia-tecnica/README.md`
- Create: `apps/assistencia-tecnica/RELEASE.md`

- [ ] Documentar Entregas 11, 12, 13 e 14.
- [ ] Registrar nome do artefato, critérios de release e acesso LAN/local.
- [ ] Abrir PR, revisar diff, mergear em `main`.
- [ ] Validar CI da `main` e build da branch de release.
