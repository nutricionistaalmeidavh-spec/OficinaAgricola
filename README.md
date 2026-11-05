# ArtiSys Oficina — PostgreSQL único

Sistema para **oficina mecânica, assistência técnica e máquinas agrícolas**, com backend canônico em PostgreSQL 16, registry global, isolamento lógico por unidade (schemas), interface web/Electron e armazenamento local de anexos.

## Instalação Windows — automática, sem terminal

O cliente executa `ArtiSys-Oficina-Setup-<versão>-Windows-x64.exe`.
O instalador inclui **PostgreSQL 16** e **ACBr** open source, sem download de dependências no computador do cliente. No primeiro início, o Electron:

1. Verifica o pacote PostgreSQL embarcado, inicia um cluster privado por usuário e cria os bancos de registry e operações;
2. Configura o ACBr com seus binários locais e arquivos de trabalho fora do instalador;
3. Inicia o gateway PostgreSQL e abre o cadastro do primeiro administrador.

**Não existem usuários anteriores para migrar.** O produto inicia com bancos novos; nenhuma importação SQLite é executada. Não há fallback silencioso para SQLite: se o PostgreSQL estiver ausente, inválido ou indisponível, o aplicativo apresenta erro explícito e não cria outra base.

- Perfil Windows: `%LOCALAPPDATA%\\ArtiSys\\Oficina`.
- Cluster: `postgres\\cluster` (dados persistentes fora do instalador).
- Registry e operações: bancos PostgreSQL privados `oficina_registry` e `oficina_operations`.
- Anexos: `storage\\postgres`; configuração fiscal em `fiscal`.
- Porta local do aplicativo: `127.0.0.1:3344`.
- Serviço PostgreSQL: processo privado do aplicativo, não instala serviço global e não exige permissão administrativa para dados do usuário.
- Desinstalação: preserva dados do perfil do usuário.

## Desenvolvimento e self-hosted

O core é **R$ 0, self-hosted e open source**: nenhuma API, hospedagem, licença ou SaaS pago é obrigatório. Para desenvolvimento fora do instalador Windows é necessário fornecer instâncias PostgreSQL próprias e as URLs `OFICINA_POSTGRES_REGISTRY_URL` e `OFICINA_POSTGRES_OPERATIONS_URL`. Esses comandos são **apenas para quem desenvolve**, não para o cliente que instala o `.exe`:

```sh
npm ci
npm run ci
npm start
```

- Gateway PostgreSQL: `src/start-postgres-unified.js`.
- Desktop: `electron/main.js` (PostgreSQL obrigatório).
- Interface: `public/`.
- Verificação PostgreSQL real: `npm run db:postgres:verify-unified` em ambiente de integração.
- O build publica apenas os módulos JavaScript alcançáveis pelo gateway PostgreSQL e bootstrap Electron. Fontes SQLite antigas, necessárias para testes históricos, **não são distribuídas no instalador**.
- CI: `npm run ci` e teste Windows NSIS de instalação limpa, primeiro administrador, login e persistência após reiniciar.

## P0 — segurança e transações
- Vendas validam consumo agregado de peças repetidas e atualizam estoque atomicamente.
- Vendas só finalizam com caixa aberto; cancelamento exige caixa corrente para registrar estorno sem alterar o fechamento antigo.
- Formulário de venda envia identificador idempotente; reenvios do mesmo pedido não baixam estoque nem registram caixa novamente.
- O mecanismo SQLite antigo foi retirado do runtime de produção. Rotinas históricas em testes não são uma alternativa operacional.
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
- **Padrão seguro:** homologação ativada automaticamente após cadastro fiscal completo; produção separada e confirmada; ninguém recebe nota fiscal automaticamente. Sem certificado, regras tributárias e emissor homologado configurados, nenhuma emissão real ocorre.
- O motor fiscal opcional pode usar **ACBrLib local** (`FISCAL_ACBR_NFE_LIB` / `FISCAL_ACBR_NFSE_LIB`) por `ctypes` em Python 3, ou um sidecar HTTP loopback (`FISCAL_LOCAL_PROVIDER_URL`), nunca os dois simultaneamente. Não há dependência de ACBr API paga. INI tributário revisado, certificado e homologação real continuam obrigatórios para emissão legal.
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

### ACBr fiscal Windows embarcado (branch de implementação)

O instalador Windows x64 é montado com worker independente de Python e bibliotecas ACBr nativas compiladas dos fontes LGPL, com teste de integridade e DLL real. O cliente final não instala Python/ACBr manualmente. Consulte [ACBR-WINDOWS-EMBUTIDO.md](docs/ACBR-WINDOWS-EMBUTIDO.md). A emissão permanece opcional/desativada até configuração legal/tributária e homologação; não há SaaS pago obrigatório.
