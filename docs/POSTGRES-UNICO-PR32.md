# PR #32 — P0/P1/P2: migração para PostgreSQL com contrato único

Atualizado em 2026-11-04. **Branch Draft; não realizar merge nem deploy.**

## Objetivo canônico

- PostgreSQL OSS, self-hosted, sem custo de licença ou SaaS obrigatório.
- API e interface devem chamar **um único contrato assíncrono** de persistência.
- O registry global de empresas, unidades, usuários, sessões e memberships terá
  banco PostgreSQL próprio; a aplicação operacional terá dados isolados por
  unidade, com identidade vinculada e validada no início de cada backend.
- Serviços D1/R2 podem continuar existindo apenas como integrações opcionais;
  não alteram o core gratuito.
- SQLite preexistente será aceito como **origem de migração auditada**, não como
  fallback automático de requisições quando PostgreSQL for escolhido.
- Não modificar chaves, secrets, login/OAuth existente ou base ativa nesta fase.

## P0 — inventário e contrato de migração

Execute:

    npm run db:postgres:audit
    node scripts/audit-postgres-readiness.mjs --strict

O primeiro comando mostra candidatos SQLite e número de mapeamentos
/api/*→/v1/*. O segundo é um **gate futuro de corte**: ele deve falhar enquanto
a aplicação ainda tiver serviços SQLite síncronos. Não é um gate obrigatório
da PR até concluir P3/P4 e revisar falsos positivos do inventário estático.

Matriz de responsabilidade, baseada no estado da branch em 04/11:

| Subsistema | Fonte atual | Destino | Fase de integração |
|---|---|---|---|
| Registry global | src/platform/tenant-registry.js | src/platform/async-postgres-registry.js | P2 implementado como serviço independente; P4 integra a UI |
| Sessões/login multiempresa | src/auth.js + multi-tenant-server.js | Registry PostgreSQL com scrypt/SHA256 | P2 nativo implementado; P4 remove sessão shadow |
| Empresa/unidade/RBAC | tenant-registry.js | Registry PostgreSQL com constraints e auditoria | P2 nativo implementado; P4 liga rotas do gateway |
| API de controle multiempresa | multi-tenant-server.js | postgres-registry-control.js | P2 nativo isolado; P4 unifica com gateway |
| Cadastros, OS e orçamentos | src/services/* + server-assistencia.js | async-workshop-*.js | P3 |
| Financeiro, vendas, caixa, estoque | src/services/* | async-workshop-*.js | P3 |
| Agenda, diagnóstico, manutenção, fiscal | serviços legados | async-workshop-*.js | P3 |
| Interface web/Electron | public/*, electron/* | mesmo gateway PostgreSQL | P4/P5 |
| Backups, outbox, conciliação | src/platform/backup* e jobs legados | PostgreSQL e storage local | P6 |
| Imports de instalações SQLite | tenant-migration-*.js | staging PostgreSQL + auditoria | P7 |

O inventário automático é um **mapa de chamadas** e não uma prova de
paridade funcional. Ainda exige revisão manual das rotas dinâmicas, jobs,
anexos, impressão e regras fiscais.

## P1 — contrato SQL comum

Ponto único: src/platform/common-data-adapter.js.

Métodos obrigatórios e assíncronos: all(sql, params), first(sql, params),
run(sql, params), batch(statements) e transaction(fn).
A interface é validada por assertCommonDataContract(port).

- PostgreSQL usa pool do driver OSS pg com conexão reservada para transações.
- SQLite existente expõe as mesmas assinaturas apenas no caminho legado.
- D1 executa batch atômico, **não** transações interativas; o contrato
  deve rejeitar esse requisito em vez de simular ACID.
- IDs BIGINT são convertidos para Number somente se estiverem no intervalo
  inteiro seguro. Valores monetários continuam em centavos, sem arredondamento.
- Falhas não fazem fallback silencioso para outro banco.

P3 ainda terá que remover todos os acessos diretos db.prepare/DatabaseSync dos
serviços legados; a existência do contrato não significa migração completa.

## P2 — registry e autenticação PostgreSQL

Novos componentes:

- src/platform/async-postgres-registry.js: tabelas e constraints PostgreSQL;
  administração de empresas, filiais, usuários e papéis; auditoria; sessões
  tokenizadas por SHA-256; validação por membership ativo; proteção do último
  administrador; bootstrap explícito e transacional.
- src/platform/postgres-registry-control.js: API de controle com rotas
  /api/setup/*, /api/auth/*, /api/tenancy/*, /api/users e /api/units.
  Outras rotas retornam 501; jamais seguem automaticamente para SQLite.
- src/start-postgres-registry.js: processo privado em loopback 127.0.0.1.
  Não serve a UI nem emite notas e não substitui o gateway principal antes
  da migração das rotas operacionais.

### Inicialização de laboratório, sem SaaS

Em um PostgreSQL local ou VPS própria, crie um banco vazio exclusivo para o
registro; conceda permissões mínimas ao usuário do serviço. Instale o driver
OSS explicitamente no ambiente de desenvolvimento, sem editar secrets:

    npm install --no-save --no-package-lock pg@8

Configure OFICINA_POSTGRES_REGISTRY_URL por variável privada do processo,
**não** em arquivos commitados, e habilite OFICINA_REGISTRY_NEW_INSTALL=true
**somente** em banco novo e vazio, nunca para tentar recuperar uma base perdida.
Inicie:

    npm run start:postgres-registry

A API de setup só pode criar o primeiro administrador durante bootstrap
explicitamente habilitado. Após a criação, desabilite essa opção no processo.
O servidor ou proxy deve proteger o endpoint; por padrão o processo só aceita
conexões locais. Não expor a API privada na internet sem HTTPS/revisão de CSRF,
cookies e limitação de tentativas distribuída.

### Testes

- Unitários: npm test (inclui tests/sql-contract.test.js e
  tests/postgres-registry-control.test.js).
- PostgreSQL real descartável: POSTGRES_TEST_URL apontando para uma instância
  de teste, então npm run db:postgres:verify-registry.
- GitHub Actions: native-backend-parity.yml executa integração PostgreSQL 16
  com schema descartável. Nenhum banco, chave ou tenant real é alterado.

## Gates ainda fechados

**Proibido declarar o Oficina 100% PostgreSQL.**

- P3: todas as operações e jobs ainda precisam de paridade no SQL assíncrono.
- P4: UI e gateway multiempresa ainda precisam ser ligados ao registry e
  serviços PostgreSQL, eliminando as sessões shadow SQLite.
- P5: instalador Windows ainda depende de SQLite no runtime legado.
- P6/P7/P8: backup/restore, migração real, testes E2E, auditoria e CI no
  commit final continuam obrigatórios.
- Não habilitar OFICINA_DATABASE_ENGINE=postgres no runtime principal nem
  remover a proteção de cutover. Main preservada; sem merge/deploy.
