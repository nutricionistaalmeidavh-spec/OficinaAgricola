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

## Instalação nova e independente
**ArtiSys Oficina é um novo produto e só será instalado em máquinas limpas.**
- **Identificador Windows/NSIS:** `com.artisys.oficina`, nome `ArtiSys Oficina`.
- **Instalador:** `ArtiSys-Oficina-Setup-<versão>-Windows-x64.exe`.
- **Dados do desktop Windows:** `%LOCALAPPDATA%\\ArtiSys\\Oficina\\data\\artisys-oficina.sqlite`.
- **Anexos do desktop:** `%LOCALAPPDATA%\\ArtiSys\\Oficina\\storage\\uploads`.
- **Execução pelo terminal:** `data/artisys-oficina.sqlite` e `storage/uploads` no diretório do projeto.
- **Não busca, importa, reaproveita nem altera bancos antigos** de OficinaAgro ou AssistenciaTecnica.
- Se `DATABASE_PATH` ou `STORAGE_DIR` forem definidos explicitamente na execução por terminal, são usados apenas para ambiente controlado ou testes; o desktop sempre usa sua pasta nova.
- A primeira instalação cria banco novo, sem necessidade de migração, mesclagem ou seleção de dados anteriores.
- Nenhum dado antigo foi apagado; arquivos das aplicações originais permanecem fora da nova instalação.

O histórico do código da Oficina Agrícola permanece recuperável pelo Git, mas há somente **uma aplicação executável** nesta versão.

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
