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

## Canonicidade (C1)
- **Estoque:** `inventory_movements` é o único livro de origem para OS, vendas, ajustes e estornos; `parts.quantity` é a projeção reconciliável.
- **Receitas:** `payment_events` é a origem para recebimentos/estornos de OS e vendas balcão; `cash_movements` registra a sessão do caixa quando aplicável.
- **Interface:** gravações não recriam páginas inteiras; `refreshCurrentPage()` reconcilia os nós alterados e preserva formulários, foco e scroll. Navegação explícita continua criando a nova tela.
- **Fiscal:** cadastro, rascunhos NF-e/NFS-e, idempotência, XML e estados de consulta preparados. **Emissão real segue desativada sem sidecar homologado e configuração explícita**; nenhum serviço fiscal pago é obrigatório.
- Detalhes e limites: [ADR-0002](docs/architecture/0002-canonicalidade-e-ui-estavel.md).

## P0 — relatórios e preparação fiscal

- Relatórios e contagens do dashboard são SQL do backend, sem corte de 200 OS ou 8 peças; entrega mensal usa `delivered_at`.
- A página de OS carrega o histórico por cursor em `/api/work-orders/page` e permite consultar ordens antigas.
- Página **Fiscal**: configuração da empresa com validação de CNPJ, rascunhos NF-e/NFS-e por OS/venda, histórico fiscal, consulta em falha indeterminada, XML e protocolo após autorização por adaptador.
- O documento comercial é congelado e o livro fiscal nunca realiza uma segunda baixa no estoque nem lançamento de recebimento/caixa.
- **Padrão seguro:** fiscal desabilitado; homologação separada de produção; ninguém recebe nota fiscal automaticamente. Sem certificado, regras tributárias e emissor homologado configurados, nenhuma emissão real ocorre.
- O único transporte opcional previsto é HTTP no computador local (`FISCAL_LOCAL_PROVIDER_URL` em loopback), implementando contrato público da aplicação. Isso não instala automaticamente um emissor de NF-e/NFS-e nem substitui certificação/credenciamento.
- Documentação, limites e checklist de validação: [P0 Fiscal e Relatórios](docs/P0-FISCAL-REPORTS.md).
## CI exclusivo no GitHub
As validações automatizadas são executadas por **GitHub Actions**:
`CI` (lint, testes, build, E2E) e `ArtiSys QA` (Playwright desktop/mobile).
Para executar sem serviços externos: `npm run ci`. Não há `.circleci/config.yml`.
Se um projeto CircleCI externo ainda estiver conectado à conta, desvincule-o nas configurações externas para impedir checks obsoletos no GitHub.

## Primeiro acesso seguro

Em uma **instalação nova**, nenhum usuário e nenhuma senha padrão são gerados. Ao abrir o aplicativo na máquina principal (`http://127.0.0.1:3344`), o formulário de primeiro acesso exige nome do responsável, usuário e uma senha forte (12+ caracteres, maiúscula, minúscula, número e símbolo). O endpoint de inicialização só funciona a partir de `localhost` e somente enquanto não houver usuários. Em seguida o administrador faz login normalmente. Máquinas da rede local podem acessar o sistema depois dessa configuração.

Para automação administrada via terminal, a variável `ADMIN_PASSWORD` pode ser informada explicitamente; não existe valor implícito. Credenciais de QA em `scripts/seed-qa-demo.mjs` são **somente** para banco efêmero de demonstração, nunca para instalações do usuário.

## Dados automotivos

Equipamentos do tipo carro/caminhão também registram **placa normalizada**, **VIN/chassi (17 caracteres)** e **quilometragem**, mantendo horímetro nos equipamentos agrícolas e técnicos. O histórico por equipamento permite registrar **revisões preventivas**, próximas revisões por data/km e **garantias** (data de vencimento), vinculadas opcionalmente a uma OS do mesmo veículo. Isso não emite notas fiscais.

## Operações pendentes (Command Queue e EventBus)

O funcionário não precisa conhecer chaves técnicas: ao salvar, o navegador registra previamente o comando no **IndexedDB local**, usa sempre o mesmo identificador ao reenviá-lo e exibe o aviso **“Operação aguardando confirmação · Tentar novamente”** caso a conexão falhe. O reenvio é automático quando o servidor local volta a responder (para pendências recentes) ou pode ser iniciado manualmente. O backend elimina a possibilidade de executar duas vezes a mesma operação identificada.

O **EventBus do frontend** notifica a interface, enquanto o **outbox SQLite + EventBus do servidor** distribuem eventos persistidos. Tokens, senhas, uploads e payloads muito grandes não são armazenados na fila. Veja [contrato e limitações de recuperação](docs/COMMAND-QUEUE-RECOVERY.md).

## Instalação Windows e proteção da main

O workflow GitHub Actions `Windows · Instalador limpo` compila o NSIS em máquina virtual Windows temporária, faz instalação silenciosa e testa bootstrap/admin/login sem publicar releases. Não substitui teste final em hardware do cliente. Instruções para configurar a proteção da `main` com os checks do GitHub: [docs/PROTEGER-MAIN.md](docs/PROTEGER-MAIN.md). O core local não depende de GitHub Actions para executar.

## Qualidade
```sh
npm run lint
npm test
npm run build
npm run test:e2e
```
Instalador Windows é opcional via `npm run desktop:dist`, sem publicação automática.

Consulte `docs/P0-CONSOLIDACAO.md` para limites, cenários e validação da unificação.
