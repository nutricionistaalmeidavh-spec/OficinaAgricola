# ArtiSys Oficina — Sistema Único

Sistema local-first para **oficina mecânica, assistência técnica e manutenção de máquinas agrícolas**, com um único runtime Node.js/SQLite e interface web/Electron. Os tipos de equipamento são cadastráveis, sem criar instalações separadas.

## Único aplicativo
- Backend: `src/start.js` → `src/server-assistencia.js` → `src/server.js`.
- Interface: `public/`.
- Desktop: `electron/main.js`.
- SQLite: `src/db.js` + migração aditiva `src/assistencia-schema.js`.
- Testes: `tests/`; `npm run ci` executa lint, testes, build e E2E.
- Porta padrão: 3344, acessível na rede local configurada.

## Rodar localmente
Requer Node.js 22.16+.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm start
```

No computador principal: http://127.0.0.1:3344. Para acesso local, utilize o IP do computador na porta 3344.

O **core R$ 0** é self-hosted, funciona localmente/offline e não possui **nenhuma API ou SaaS pago obrigatório**. O desktop usa Electron; provedores pagos são opcionais, nunca pré-requisitos.

## Dados legados — atenção
A unificação do repositório **não apaga nem mescla automaticamente bancos existentes**.
O sistema detecta fontes históricas de execução por terminal (`data/oficina.sqlite`, `data/assistencia-tecnica.sqlite`, `apps/assistencia-tecnica/data/assistencia-tecnica.sqlite`) e Windows (`ArtiSys/OficinaAgro/data/oficina.sqlite`, `ArtiSys/AssistenciaTecnica/data/assistencia-tecnica.sqlite`).
- Se houver uma única fonte conhecida, ela será reutilizada sem mover arquivos.
- Se houver duas ou mais fontes, o sistema não inicia sem seleção explícita via `DATABASE_PATH`. Isso impede esconder dados de uma aplicação ou sobrescrever outra.
- Se for instalação nova, usa `data/artisys-oficina.sqlite` (terminal) ou pasta de dados da Assistência Técnica (Windows).
- Anexos seguem a pasta associada ao banco histórico quando disponível.
- Para mesclar **dois bancos com dados distintos**, será necessária migração conciliada com mapeamento de IDs e relatório de conflitos. Não use cópia por cima de outro banco.

O código histórico da Oficina Agrícola permanece recuperável pelo histórico Git, mas **não existe uma segunda aplicação executável neste checkout**.

## P0 — segurança e transações
- Vendas validam consumo agregado de peças repetidas e atualizam estoque atomicamente.
- Vendas só finalizam com caixa aberto; cancelamento exige caixa corrente para registrar estorno sem alterar o fechamento antigo.
- Formulário de venda envia identificador idempotente; reenvios do mesmo pedido não baixam estoque nem registram caixa novamente.
- Backup com SQLite `VACUUM INTO` gera snapshot consistente, incluindo mudanças ainda no WAL.
- Integração fiscal real permanece **desativada**. Nada é transmitido à SEFAZ pela oficina.

## Qualidade
```sh
npm run lint
npm test
npm run build
npm run test:e2e
```
Instalador Windows é opcional via `npm run desktop:dist`, sem publicação automática.

Consulte `docs/P0-CONSOLIDACAO.md` para limites, cenários e validação da unificação.
