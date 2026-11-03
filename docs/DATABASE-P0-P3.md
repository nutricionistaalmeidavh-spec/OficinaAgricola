# Banco de dados — P0 a P3 (2026-11-03)

## Escopo
SQLite self-hosted, offline, sem serviços externos pagos, alteração aditiva e sem modificação de secrets.
As tabelas financeiras, histórico, documentos fiscais e chaves de idempotência são preservadas.

### P0 — Paginação por cursor
Endpoints novos e compatíveis:
- `GET /api/customers/page`: `includeInactive`, `search`, `limit`, `cursor`
- `GET /api/machines/page`: mais `customerId`
- `GET /api/parts/page`
- `GET /api/work-orders/page` (já existente)
- `GET /api/sales/page`: mais `status`
- `GET /api/expenses/page`: `from`, `to`
- `GET /api/schedule/page`: `from`, `to`
- `GET /api/fiscal/page`: mais `status`

Respostas: `{items,total,nextCursor}`. O limite é validado e limitado a 100.
Cursores de listagem são vinculados a filtro e ordenação, com desempate por ID.
As rotas legadas mantêm contrato de array para preservar integrações e formulários antigos.
Telas principais usam carregamento incremental, sem exigir download integral do conjunto de registros. 
Os seletores de formulários ainda usam rotas legadas sob demanda para preservar seleção de qualquer registro; devem ser avaliados separadamente para volumes extremos.

### P1 — SQL e índices
Índices compostos para OS, veículos, clientes, peças, financeiro, anexos, histórico e dados fiscais.
O financeiro calcula pendências em uma consulta agregada, em vez de executar chamadas por OS.
Consultas de agenda e alertas do dashboard recebem limites no SQLite.

**Não criar índices arbitrariamente**: conferir em bancos reais usando `npm run db:health -- /caminho/oficina.sqlite` e `EXPLAIN QUERY PLAN`.

### P2 — Migração, recuperação e auditoria
- `schema_migrations` controla versões aplicadas em transação.
- Backfill de movimentações de venda legadas permanece aditivo e verifica linhas faltantes.
- Sessões expiradas são removidas; nunca excluir lançamentos financeiros ou chaves de idempotência automaticamente.
- Eventos já entregues na outbox só são excluídos se `OUTBOX_RETENTION_DAYS` maior que zero for explicitamente definido.
- Reenvio automático utiliza espera exponencial; replay manual continua disponível.
- Conciliação operacional automática percorre lotes e permite auditoria completa sob demanda.
- `PRAGMA optimize` executa durante manutenção programada.

### P3 — Ferramentas e gates
- `npm run db:benchmark -- --size=1000`
- `npm run db:benchmark -- --size=10000`
- `npm run db:benchmark -- --size=100000`
- `npm run db:health -- /caminho/banco.sqlite` (somente leitura)
- `npm run ci`: lint, testes, build e E2E.
- A suíte de testes valida 1.000 registros, cursores, índices e migrações.
- Benchmarks geram p50/p95 em JSON; não se impõem limiares universais de tempo porque dependem da máquina.

## Restrições e rollback
1. Backup verificado e restaurável antes de atualizar um banco de cliente.
2. Nunca regravar saldos históricos, documentos fiscais ou identificadores de operação.
3. Gate de regressão verde antes de merge ou publicação.
4. Migrações aditivas não possuem down migration: rollback do executável exige banco compatível ou restauração do backup validado.
5. Arquivos SQLite reais, certificado digital e credenciais não entram no repositório.

## Atenções ainda existentes
Os contratos legados de listagem integral e formulários com catálogo completo continuam disponíveis por compatibilidade. Para bases com centenas de milhares de clientes, peças e veículos, substituir a escolha por `select` pelo componente de pesquisa remota exige fase específica de UX e testes de usuário; não cortar resultados silenciosamente.
