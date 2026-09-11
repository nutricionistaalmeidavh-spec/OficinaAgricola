# Oficina Agrícola — Entregas 00–06 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma V1 operacional e independente para oficina agrícola cobrindo base, cadastros, OS, orçamento/documentos, estoque, agenda/checklists/fotos e financeiro.

**Architecture:** Monorepo npm com React/Vite no frontend, Fastify no backend, regras compartilhadas em TypeScript e SQLite local. A API concentra persistência, autorização e regras transacionais; a interface consome apenas REST. Arquivos ficam em armazenamento local controlado e o banco guarda metadados.

**Tech Stack:** Node.js 22+, TypeScript, React 19, Vite, Fastify, Zod, SQLite via better-sqlite3, Drizzle ORM, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-11-oficina-agricola-v1-design.md`

## Global Constraints

- Repositório e banco próprios; nenhuma alteração no PDV existente.
- Núcleo R$ 0, self-hosted e open source.
- Nenhum SaaS ou serviço pago como dependência obrigatória.
- Interface responsiva, utilizável em desktop e celular.
- Dados persistentes em SQLite no modo local/self-hosted.
- Operações críticas testáveis sem internet.
- Senhas nunca armazenadas em texto puro.
- Validação visual é opcional e não bloqueia o pipeline padrão.

---

## File map

```text
apps/api/src/
  app.ts                 # instancia Fastify e plugins
  server.ts              # bootstrap HTTP
  auth.ts                # login, sessão e guardas de perfil
  routes/                 # endpoints por módulo
  services/               # regras transacionais por módulo
  documents/              # HTML imprimível de OS/orçamento/recibo
apps/web/src/
  App.tsx                 # shell, rotas e navegação
  api.ts                  # cliente HTTP autenticado
  pages/                  # telas por módulo
  components/             # cards, tabelas, formulários e modal
packages/domain/src/
  schemas.ts              # Zod + enums + tipos compartilhados
  os-machine.ts           # transições válidas da OS
  money.ts                # cálculos de orçamento/pagamento
packages/database/src/
  schema.ts               # Drizzle schema
  client.ts               # conexão SQLite
  migrate.ts              # criação/migração determinística
  seed.ts                 # admin e dados demo
  repositories.ts         # operações persistentes reutilizadas
storage/uploads/          # arquivos locais ignorados pelo git
tests/integration/        # testes de domínio/API
tests/e2e/                # fluxo crítico Playwright
```

---

### Task 1: Entrega 00 — scaffold, domínio, banco e autenticação

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.env.example`, `.gitignore`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/auth.ts`
- Create: `packages/domain/package.json`, `packages/domain/src/schemas.ts`, `packages/domain/src/os-machine.ts`, `packages/domain/src/money.ts`
- Create: `packages/database/package.json`, `packages/database/src/schema.ts`, `packages/database/src/client.ts`, `packages/database/src/migrate.ts`, `packages/database/src/seed.ts`
- Test: `tests/integration/domain.test.ts`, `tests/integration/auth.test.ts`

**Interfaces:**
- Produces `buildApp()`, `requireAuth()`, `requireRole()`, `assertTransition()`, `calculateQuote()`, `calculatePaymentStatus()`.
- Produces SQLite tables para usuários, sessões, configurações da empresa e todos os módulos posteriores.

- [ ] **Step 1: Write failing domain tests**

```ts
expect(() => assertTransition('ENTRADA', 'EM_SERVICO')).toThrow();
expect(assertTransition('ENTRADA', 'DIAGNOSTICO')).toBe(true);
expect(calculateQuote([{ qty: 2, unitPrice: 100 }], 10)).toEqual({ subtotal: 200, discount: 10, total: 190 });
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/integration/domain.test.ts`
Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement domain enums, transitions and money helpers**

Use exact OS statuses from the spec and reject transitions outside the declared graph. Monetary values are stored as integer cents.

- [ ] **Step 4: Implement SQLite schema and deterministic migration**

Create tables with foreign keys enabled, timestamps in ISO UTC strings, soft-active flags where required, audit tables for OS status, inventory movements and receipts.

- [ ] **Step 5: Implement local auth**

Use Node `crypto.scrypt` with per-user salt; create random session tokens with `crypto.randomBytes(32)`, store token hashes in SQLite and expose `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

- [ ] **Step 6: Seed safely**

`db:seed` reads `ADMIN_PASSWORD` from environment; development may use a clearly marked demo password only when `NODE_ENV !== 'production'`.

- [ ] **Step 7: Add API healthcheck and standardized errors**

`GET /api/health` returns `{ ok: true }`; validation errors are 400, auth 401/403, not-found 404 and conflicts 409.

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: PASS for domain/auth tests.

- [ ] **Step 9: Commit**

`git commit -m "feat: scaffold oficina core database and auth"`

---

### Task 2: Entrega 01 — clientes, máquinas e técnicos

**Files:**
- Create: `apps/api/src/routes/customers.ts`, `machines.ts`, `technicians.ts`
- Create: `apps/api/src/services/catalog.ts`
- Modify: `apps/api/src/app.ts`
- Test: `tests/integration/catalog.test.ts`

**Interfaces:**
- `POST/GET/PATCH /api/customers`
- `POST/GET/PATCH /api/machines`
- `POST/GET/PATCH /api/technicians`
- `GET /api/customers/:id/machines`
- `GET /api/machines/:id/history`

- [ ] **Step 1: Write tests for create/list/update and integrity**

Validate required fields, ownership of machine, technician optional user relation and soft deactivation.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/integration/catalog.test.ts`.

- [ ] **Step 3: Implement schemas and service methods**

CPF/CNPJ remains text to preserve formatting; email is optional but validated when present; horimeter is non-negative.

- [ ] **Step 4: Implement routes with role checks**

ADMIN/ATENDIMENTO can maintain customers and machines; ADMIN can manage technician records; authenticated roles can read.

- [ ] **Step 5: Enforce non-destructive history**

A customer with machine/OS and a machine with OS can only be set inactive, never hard-deleted by normal routes.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`; commit `feat: add customers machines and technicians`.

---

### Task 3: Entrega 02 — ordens de serviço e histórico de status

**Files:**
- Create: `apps/api/src/routes/work-orders.ts`
- Create: `apps/api/src/services/work-orders.ts`
- Modify: `packages/domain/src/schemas.ts`
- Test: `tests/integration/work-orders.test.ts`

**Interfaces:**
- `POST /api/work-orders`
- `GET /api/work-orders`
- `GET /api/work-orders/:id`
- `PATCH /api/work-orders/:id`
- `POST /api/work-orders/:id/status`
- `GET /api/work-orders/:id/history`

- [ ] **Step 1: Write transition and sequencing tests**

First OS receives sequential number 1; invalid transition returns 409; each transition inserts `work_order_status_history`.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/integration/work-orders.test.ts`.

- [ ] **Step 3: Implement transactional OS creation**

Validate customer owns selected machine; snapshot customer/machine identifying fields in the OS record for historical output.

- [ ] **Step 4: Implement transitions**

Use `assertTransition`; set conclusion timestamp on PRONTA and delivery timestamp on ENTREGUE.

- [ ] **Step 5: Implement machine history aggregation**

Machine history returns its OS records ordered newest first with status, dates, diagnosis and totals.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`; commit `feat: add auditable work orders`.

---

### Task 4: Entrega 03 — orçamento, aprovação e documentos imprimíveis

**Files:**
- Create: `apps/api/src/routes/quotes.ts`, `apps/api/src/routes/documents.ts`
- Create: `apps/api/src/services/quotes.ts`
- Create: `apps/api/src/documents/render.ts`
- Test: `tests/integration/quotes.test.ts`, `tests/integration/documents.test.ts`

**Interfaces:**
- `PUT /api/work-orders/:id/quote`
- `POST /api/work-orders/:id/quote/approve`
- `POST /api/work-orders/:id/quote/reject`
- `GET /api/work-orders/:id/documents/:kind` with kinds `quote`, `work-order`, `delivery`, `receipt`.

- [ ] **Step 1: Write quote calculation and approval tests**

Parts, labor and third-party items calculate subtotal/discount/total in cents. Approval transitions ORCAMENTO/AGUARDANDO_APROVACAO to APROVADA; rejection records reason.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/integration/quotes.test.ts`.

- [ ] **Step 3: Implement quote persistence**

Replace draft items transactionally; when OS reaches final states preserve final quote snapshot and block accidental edits without ADMIN correction flow.

- [ ] **Step 4: Implement HTML documents**

Render local printable HTML with company, customer, machine, OS and totals. Do not call external APIs.

- [ ] **Step 5: Test document content**

Assert generated HTML contains OS number, customer, machine and expected total without exposing internal notes in customer-facing documents.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`; commit `feat: add quotes approvals and printable documents`.

---

### Task 5: Entrega 04 — peças, estoque, consumo e estorno

**Files:**
- Create: `apps/api/src/routes/inventory.ts`
- Create: `apps/api/src/services/inventory.ts`
- Test: `tests/integration/inventory.test.ts`

**Interfaces:**
- CRUD lógico em `/api/parts`
- `POST /api/inventory/movements`
- `POST /api/work-orders/:id/parts`
- `POST /api/work-orders/:id/parts/:itemId/reverse`
- `GET /api/inventory/low-stock`

- [ ] **Step 1: Write inventory tests**

Test entry, manual exit, OS consumption, reversal and insufficient stock. Negative stock without `ADMIN` explicit override returns 409.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/integration/inventory.test.ts`.

- [ ] **Step 3: Implement movements as append-only audit records**

Every quantity change creates an inventory movement; current stock changes in the same SQLite transaction.

- [ ] **Step 4: Link part consumption to approved/in-service OS**

Reject consumption for inappropriate OS statuses. Reversal inserts inverse movement rather than deleting history.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`; commit `feat: add parts and auditable inventory`.

---

### Task 6: Entrega 05 — agenda, checklist e anexos locais

**Files:**
- Create: `apps/api/src/routes/schedule.ts`, `checklists.ts`, `attachments.ts`
- Create: `apps/api/src/services/attachments.ts`
- Test: `tests/integration/operations.test.ts`

**Interfaces:**
- `/api/schedule`
- `/api/checklist-templates`
- `/api/work-orders/:id/checklists`
- `/api/work-orders/:id/attachments`

- [ ] **Step 1: Write agenda/checklist tests**

Validate event types, optional links, configured checklist response enum and initial ENTRY/DELIVERY templates from seed.

- [ ] **Step 2: Write attachment safety tests**

Accept only configured MIME/size, generate server-side filenames, normalize paths and forbid traversal.

- [ ] **Step 3: Verify failure**

Run: `npm test -- tests/integration/operations.test.ts`.

- [ ] **Step 4: Implement agenda and checklist persistence**

Checklist responses preserve template item label snapshots so later template edits do not rewrite old inspections.

- [ ] **Step 5: Implement multipart local uploads**

Store under `STORAGE_DIR/<workOrderId>/` and save only controlled relative path plus metadata in SQLite.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`; commit `feat: add schedule checklists and local attachments`.

---

### Task 7: Entrega 06 — financeiro e visão financeira

**Files:**
- Create: `apps/api/src/routes/finance.ts`
- Create: `apps/api/src/services/finance.ts`
- Test: `tests/integration/finance.test.ts`

**Interfaces:**
- `POST /api/work-orders/:id/receipts`
- `POST /api/work-orders/:id/receipts/:receiptId/reverse`
- `/api/expenses`
- `GET /api/finance/summary?from=&to=`

- [ ] **Step 1: Write partial/full payment tests**

For total 10000 cents: receipts 4000 => PARCIAL/6000 pending; additional 6000 => PAGO/0. Reversal recomputes status.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/integration/finance.test.ts`.

- [ ] **Step 3: Implement append-only receipts and reversal**

Never edit historical receipt amount in place; correction creates reversal metadata and a replacement receipt when needed.

- [ ] **Step 4: Implement expenses and summary**

Return invoiced totals, actually received values, pending values, paid expenses and simple result for requested inclusive period.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`; commit `feat: add work order finance and expenses`.

---

### Task 8: Dashboard and responsive web application

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `App.tsx`, `api.ts`, `styles.css`
- Create: `apps/web/src/pages/Login.tsx`, `Dashboard.tsx`, `Customers.tsx`, `Machines.tsx`, `WorkOrders.tsx`, `Inventory.tsx`, `Schedule.tsx`, `Finance.tsx`
- Create: `apps/web/src/components/*`
- Create: `apps/api/src/routes/dashboard.ts`

**Interfaces:**
- `GET /api/dashboard`
- Responsive navigation and functional forms/tables for Entregas 00–06.

- [ ] **Step 1: Implement dashboard endpoint from real data**

Counts for open/diagnosis/waiting/in-service/ready, period revenue, next schedule items and low-stock parts.

- [ ] **Step 2: Build responsive shell**

Dark green/white agricultural workshop identity inspired by the supplied references without copying their artwork. Desktop sidebar collapses to mobile bottom/compact navigation.

- [ ] **Step 3: Implement operational screens**

Each screen must create/read/update its module via API; OS detail must expose diagnosis, quote, parts, checklist, attachments, payment and status actions in one workflow.

- [ ] **Step 4: Build production assets**

Run: `npm run build`.
Expected: API and web compile without TypeScript errors.

- [ ] **Step 5: Commit**

`git commit -m "feat: add responsive oficina operations UI"`.

---

### Task 9: E2E, CI and delivery gate

**Files:**
- Create: `tests/e2e/critical-flow.spec.ts`, `playwright.config.ts`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- CI runs lint, test and build without visual-regression dependency.

- [ ] **Step 1: Write critical Playwright flow**

Automate login → customer → machine → OS → diagnosis → quote → approval → part consumption → checklist → attachment metadata/upload → complete → receipt → delivery → machine history.

- [ ] **Step 2: Add CI**

Use Node 22; `npm install`, `npm run lint`, `npm test`, `npm run build`. Playwright critical flow runs after Chromium install.

- [ ] **Step 3: Document local/self-hosted startup**

README includes prerequisites, env, migration, seed, dev, production build, storage and backup of DB/uploads.

- [ ] **Step 4: Run full gates**

Run: `npm run lint && npm test && npm run build && npm run test:e2e`.
Expected: all green.

- [ ] **Step 5: Merge only after green gates**

Open PR from `feat/oficina-v1-00-06` to `main`, review changed files and merge only if CI passes.
