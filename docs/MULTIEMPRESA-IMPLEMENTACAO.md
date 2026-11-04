# ArtiSys Oficina — modo multiempresa (branch experimental)

## Estado real

- Implementado: registro central de empresas, unidades e vínculos; autenticação central; RBAC por unidade; gateway HTTP que encaminha toda rota operacional autorizada para SQLite exclusivo e diretório de uploads exclusivo da unidade.
- Implementado: migração aditiva dos usuários legados (Matriz 1/1 preservada), painel de cadastro de empresas/unidades/vínculos, seletor, revogação, isolamento da fila offline por unidade, links públicos de aprovação vinculados à unidade e backups verificados de registro e unidades.
- **Implementado na branch:** anexos S3 opcionais para novos uploads, emissores fiscais segregados por CNPJ, transferência operacional de OS inclusive complexas com dossiê financeiro/fiscal na origem, recuperação remota para staging verificado e núcleo SQL assíncrono experimental para PostgreSQL e D1. **Ainda pendente:** migração integral da UI e de todas as rotas antigas para PostgreSQL/D1, execução transacional completa por empresa, reconciliação/retention de objetos e restore coordenado de registro + filiais. Core SQLite + disco continua R$ 0.
- A main continua usando o modo legado. O modo multiempresa é opt-in e depende de revisão.
- Resumo gerencial autorizado entre unidades da mesma empresa: quantidades operacionais e consolidação financeira por livro de pagamentos e despesas efetivamente pagas. Não substitui contabilidade, apuração fiscal ou conciliação bancária.
- Se o banco antigo tiver ordens de serviço com unit_id diferente da Matriz (1), o gateway **recusa iniciar** até executar migração específica e auditada. Nunca reatribui as OS para a Matriz silenciosamente.

## Provedores configuráveis com falha explícita

O runtime operacional ainda requer `OFICINA_DATABASE_ENGINE=sqlite`. O armazenamento **principal dos anexos novos** pode ser `OFICINA_OBJECT_STORAGE=disk` (padrão) ou `OFICINA_OBJECT_STORAGE=s3` (opt-in, MinIO ou R2 com credenciais próprias). Emissão fiscal isolada e armazenamento S3 são opcionais. Solicitar `postgres` ou `d1` como banco principal encerra a inicialização com erro até que o domínio seja migrado: não há fallback silencioso para SQLite.

## Iniciar no próprio servidor (R$ 0)

Requer Node 22.16 ou superior, sem SaaS obrigatório:

    npm ci
    npm run start:multi

Abra http://127.0.0.1:3344 localmente, configure o primeiro administrador e acesse Gerenciar empresas para cadastrar organizações e filiais.

Configurações de caminhos opcionais:

    DATABASE_PATH=/srv/oficina/data/legado.sqlite
    STORAGE_DIR=/srv/oficina/storage/uploads
    TENANCY_REGISTRY_PATH=/srv/oficina/data/oficina-registry.sqlite
    TENANCY_DATA_ROOT=/srv/oficina/data/oficina-tenants
    BACKUP_ROOT=/srv/oficina/backups
    HOST=127.0.0.1
    PORT=3344

Cada unidade nova recebe company-ID/unit-ID/oficina.sqlite e uploads. A matriz reutiliza os dados existentes.

Rede: coloque reverse proxy HTTPS (Caddy/Nginx) no mesmo host mantendo Node preso a localhost, ou configure os certificados TLS do aplicativo para acesso LAN. Não exponha HTTP em rede externa; não rode simultaneamente runtime legado e multiempresa com o mesmo banco.

Backups: snapshots consistentes, verificados por restauração e integridade para registro e unidades inicializadas, sob BACKUP_ROOT. Restaurar registro e bancos juntos para recuperação. O sistema recusa a recriação automática do registro perdido.

## Segurança

1. Toda API operacional requer sessão global válida e membership ativo para a unidade. Nenhum identificador enviado pelo cliente concede acesso sozinho.
2. Se houver várias unidades permitidas, a API exige cabeçalho X-Oficina-Unit. Mudanças de contexto recarregam a UI; filas offline usam chave de usuário + unidade.
3. Usuários podem ter papéis diferentes nas unidades; ADMIN gerencia vínculos da sua unidade, e administrador da plataforma cadastra novas empresas.
4. Aprovação pública usa token e identificador explícito de unidade, verificados no banco daquela unidade.
5. Senha global nunca é copiada para bancos operacionais. Contas técnicas locais recebem hashes de senhas aleatórias.

## Consolidação gerencial e compartilhamento de catálogo

- `GET /api/tenancy/company-summary?companyId=...&from=...&to=...` retorna dados por unidade e totais financeiros em centavos; `from` e `to` usam ISO UTC. Exige vínculo ADMIN ativo em **todas as unidades** da empresa (mesma regra para a auditoria global). Administradores de uma filial isolada não visualizam dados de filiais irmãs. A regra reutiliza `financeSummary` sobre cada SQLite isolado, sem trocar contabilidade pelo dashboard.
- `GET /api/tenancy/shareable-parts?unitId=...` lista no máximo 100 peças ativas por consulta, apenas para administrador da unidade.
- `POST /api/tenancy/share-part` recebe `sourceUnitId`, `targetUnitId`, `partId`, exige administração nas duas unidades e que pertençam à mesma empresa, gera auditoria de solicitação/conclusão e não transfere estoque. Requisição repetida devolve o cadastro original e não duplicará a peça.
- `GET /api/tenancy/shareable-customers?unitId=...` lista IDs e nomes (100 por consulta); `POST /api/tenancy/share-customer` recebe `sourceUnitId`, `targetUnitId`, `customerId`, `legalBasis` e `recordReference` (8–120 caracteres). Copia nome, documento, contato e endereço; **não copia notas livres, máquinas, ordens nem dados financeiros**. Recusa cliente com mesmo documento já presente no destino; não infere que a justificativa fornecida satisfaz a LGPD.
- O modal **Gerenciar empresas** contém Resumo da empresa (com valores financeiros), Compartilhar catálogo e Compartilhar cliente. Nenhuma transferência ocorre automaticamente.
- Auditoria grava em registro central e inserção no banco da unidade ocorre em transação própria. Não há transação distribuída: se uma queda interromper a operação entre essas etapas, revisar eventos `CATALOG_SHARE_REQUESTED`/`CUSTOMER_SHARE_REQUESTED` sem seus eventos `*_COMPLETED`. Requer rotina de reconciliação antes de promover a funcionalidade a sincronização automática.

## Transferência manual de estoque com segurança

- **Pré-condições:** unidades na mesma empresa, vínculo ADMIN ativo nas duas, peça com SKU e unidade de medida equivalentes cadastrada no destino, saldo suficiente na origem e `requestId` único e estável.
- `POST /api/tenancy/stock-transfer` recebe `sourceUnitId`, `targetUnitId`, `sourcePartId`, `quantity`, `requestId` (e `targetPartId` opcional). O registro central persiste uma intenção antes da baixa.
- A saída usa `postStockMovement(...TENANT_TRANSFER_OUT...)` na origem; a entrada usa `postStockMovement(...TENANT_TRANSFER_IN...)` no destino. Ambas referenciam o mesmo ID de transferência, com chaves únicas, evitando dupla baixa/crédito em replays.
- Quando o destino está temporariamente indisponível depois da baixa, a API responde HTTP 202 com `status=PENDING`. Esse estoque fica **em trânsito**, não disponível em nenhuma das filiais até conclusão. O operador vê o ID e retoma via `POST /api/tenancy/stock-transfer/retry` com `transferId`.
- `GET /api/tenancy/stock-transfers?companyId=...` lista até 100 transferências recentes somente a quem possui acesso ADMIN a **todas as unidades** da empresa. O painel fornece **Transferir estoque** e **Transferências / retomar**.
- A operação gera evento `STOCK_TRANSFER_COMPLETED` no registro central quando finalizada. Não lança valores no financeiro e não substitui documento fiscal de movimentação física.
- **Limite operacional:** não há transação atômica entre dois SQLite. Em falha parcial, o estado PENDING e o replay são o controle de recuperação. Exigir reconciliação periódica, teste de desastres e fluxo de atendimento para transferências que não sejam concluídas.

## Cópia de backups para MinIO / Cloudflare R2 (opcional)

Por padrão, o core mantém SQLite e anexos no disco (100% self-hosted). Além da replicação de backup, o modo multiempresa oferece **armazenamento primário S3 para anexos novos**, habilitado explicitamente. A base operacional e o histórico de anexos locais continuam em SQLite/disco; não há migração silenciosa dos anexos anteriores.

- Configure `OFICINA_BACKUP_S3_ENDPOINT`, `OFICINA_BACKUP_S3_BUCKET`, `OFICINA_BACKUP_S3_REGION`, `OFICINA_BACKUP_S3_PREFIX`, `OFICINA_BACKUP_S3_ACCESS_KEY_ID`, `OFICINA_BACKUP_S3_SECRET_ACCESS_KEY` no ambiente privado do serviço. Todas são opcionais; sem endpoint, nenhuma requisição remota ocorre.
- Endpoint HTTPS obrigatório fora de loopback; MinIO local em `http://127.0.0.1:9000` é aceito para laboratório. MinIO é open source e pode ser executado pelo cliente. Cloudflare R2 é uma alternativa explícita, sujeita ao preço e limites próprios.
- Cada backup local é criado com snapshot SQLite consistente e validado antes do envio. O cliente S3 usa AWS SigV4 sem dependências NPM adicionais, assina o SHA-256, faz PUT dos arquivos e HEAD para conferir metadados de integridade e tamanho. O `manifest.json` é enviado por último.
- Se o storage externo falhar, o backup local permanece intacto e a próxima execução pode repetir o upload do mesmo arquivo de backup. As credenciais nunca são incluídas em logs ou commits.
- **Limitações:** não há backup remoto contínuo, versão retida/expirada remotamente ou restauração remota automática. É necessário testar a restauração manual com arquivos recuperados do bucket; o bucket deve ser privado, com controle próprio de acesso e redundância.

### Recuperação remota verificada, sem risco de sobrescrever dados

A cópia S3 foi estendida com download de objetos em streaming, verificação incremental SHA-256 e staging isolado em disco. O comando de recuperação opcional não exige Cloudflare ou serviço pago (MinIO self-hosted funciona):

    node scripts/stage-remote-backup.mjs registry/<identificador-do-backup> /srv/oficina/staging

Ele utiliza as variáveis privadas OFICINA_BACKUP_S3_* já configuradas, reconstrói o manifesto e confirma a integridade de cada arquivo. O arquivo final fica em pasta nova `verified-...`; **não modifica banco operacional, diretório de anexos ou registro atual**. Entradas do manifesto com `../`, symlink ou nomes inválidos são recusadas. O estágio limita a quantidade e tamanho de arquivos para reduzir riscos de exaustão de recursos.

A restauração de um conjunto multiempresa **exige desligar o serviço e recuperar registro + todos os bancos da mesma rodada**, validando memberships e integridade após a restauração. Não automatizar substituição parcial de arquivos vivos.

## Anexos como objetos principais S3 (MinIO/R2)

- Defina `OFICINA_OBJECT_STORAGE=s3` e `OFICINA_ATTACHMENT_S3_ENDPOINT`, `_BUCKET`, `_REGION`, `_PREFIX`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` com os prefixos completos `OFICINA_ATTACHMENT_S3_...`. Todas as credenciais ficam no ambiente privado, sem arquivo de secrets no Git.
- O gateway constrói o prefixo `company-<id>/unit-<id>` a partir do registro central confiável, nunca da requisição do cliente. O servidor exige autenticação e vínculo para escrita/leitura.
- `POST /api/work-orders/:id/attachments` faz upload assíncrono S3, verifica SHA-256/tamanho, cria referência canônica SQLite e evento na outbox de forma transacional. Replays com o mesmo `requestId` não duplicam anexos; se a escrita SQLite falhar, tenta remover o objeto remoto.
- `GET /api/attachments/:id/file` lê do S3 somente quando o registro autorizado aponta para `s3:`; registros legados continuam lendo do disco. Limite de 5 MB; tipos JPEG, PNG, WebP e PDF.
- PDFs gerados sob demanda pelo sistema permanecem gerados em memória; PDFs **anexados** usam o storage selecionado. Não há cache remoto automático de todos os PDFs gerados.
- Um erro na remoção pós-falha pode deixar objeto órfão. Adicionar reconciliação de buckets/retention antes de exigir conformidade de produção.

## Emissores fiscais segregados por empresa e CNPJ

- Defina `TENANCY_FISCAL_CONFIG_FILE` como caminho privado de um JSON em que cada chave corresponde ao ID da empresa no registro central; exemplo de formato (não use CNPJ real no repositório): `{"2":{"type":"sidecar","url":"http://127.0.0.1:4102","cnpj":"<CNPJ_14_DIGITOS>"}}`.
- Para ACBr use `{"2":{"type":"acbr","cnpj":"<CNPJ_14_DIGITOS>","inputDir":"/srv/fiscal/empresa-2","nfeLib":"/usr/local/lib/ACBrNFe64.so","nfeConfig":"/srv/fiscal/empresa-2/nfe.ini"}}`, com `nfseLib`/`nfseConfig` quando aplicável. Compilação/configuração oficial continua necessária.
- Em cada transmissão/consulta, o CNPJ do snapshot fiscal é verificado contra o CNPJ atribuído à empresa; chamadas com outro CNPJ são rejeitadas antes de alcançar o adaptador. Um ID de empresa sem emissor configurado não herda os caminhos fiscais globais da matriz.
- O emissor real depende de credenciamento SEFAZ/município, certificado digital, conteúdo tributário, ambiente configurado e homologação. Não registrar credenciais no banco nem no Git.

## Transferência operacional de OS com dossiê completo e proveniência

- `POST /api/tenancy/os-transfer` recebe `sourceUnitId`, `targetUnitId`, `workOrderId`, `legalBasis`, `recordReference`, `requestId`. Exige ADMIN ativo nas duas unidades da **mesma empresa**. Rejeita OS terminal (cancelada, entregue, já transferida).
- OS em qualquer etapa operacional aberta podem ser transferidas, inclusive com orçamento aprovado, recebimentos, despesas, peças consumidas, documentos fiscais, checklists, agenda e anexos. **A transferência não muda o responsável legal pelos lançamentos passados**: permanecem nos livros originais, sem duplicar pagamentos, estoque ou emissão de NF na filial de destino.
- A unidade destino recebe nova OS de continuidade (`ENTRADA`, ou `DIAGNOSTICO` quando aplicável), novo ID local, cliente e veículo vinculados, sem observações privadas e sem novo orçamento automaticamente aprovado. A unidade origem muda para estado terminal `TRANSFERIDA`, que **não é cancelamento nem estorno**; a receita faturada, valores pendentes, notas e pagamentos permanecem contabilizados na origem.
- A intenção durável guarda ID de origem, destino, base legal, referência e versão da OS na origem. A atualização de estado usa controle de versão para falhar em caso de alteração concorrente. Se o servidor cair depois de copiar destino, `POST /api/tenancy/os-transfer/retry` retoma por `transferId` sem duplicar OS e mantém auditoria.
- `GET /api/tenancy/os-transfers?companyId=...` lista histórico auditado apenas para ADMIN de **todas** as unidades da empresa. `GET /api/tenancy/os-transfer/:id/dossier` exige ADMIN nas **duas** unidades envolvidas e consulta, na fonte original, orçamento, itens, recebimentos, eventos de pagamento, consumos de estoque, despesas, fiscal, anexos, checklists, agenda e alterações da OS, sem replicar livros.
- `GET /api/tenancy/os-transfer/:id/attachments/:attachmentId/file` exige a mesma autorização, verifica se o anexo pertence à OS original e baixa com restrição de diretório, verificação de tamanho e acesso ao storage correto (disco ou S3). O painel mostra os históricos e baixa os arquivos autenticadamente.
- `GET /api/tenancy/os-transfer/:id/fiscal/:documentId/xml` libera somente o XML **já autorizado** e originalmente emitido (sem reemitir), após verificar ADMIN em ambas as filiais e que o documento pertence à OS original.
- **Limite fiscal:** transferência operacional não transfere titularidade de NF-e/NFS-e, obrigações de estorno, crédito de estoque já consumido, conta a receber ou certificado de emitente. Essas obrigações permanecem na empresa/unidade original; movimentações físicas novas exigem operação de estoque/documentação própria.
- Não existem transações distribuídas entre os bancos das filiais: a continuidade depende de saga e reconciliação em falhas parciais. Para operações históricas irregulares, auditar antes de transferir, sem copiar automaticamente lançamentos com inconsistências.

## Portas SQL assíncronas nativas (fase de migração)

- `src/platform/async-sql-ports.js` disponibiliza portas PostgreSQL (com pool do driver OSS `pg` injetado) e Cloudflare D1 (binding nativo de Worker) para consultas parametrizadas, execuções e transações suportadas.
- PostgreSQL oferece `BEGIN/COMMIT/ROLLBACK` por conexão; D1 oferece `batch` atômico. D1 não permite simular transações interativas de múltiplas chamadas; a porta falha explicitamente nesses casos.
- **O domínio principal ainda usa `DatabaseSync` síncrono**. Não ativar PostgreSQL/D1 como armazenamento canônico até migrar serviços, migrações SQL, identidade, outbox e testes com bancos reais. A existência dessas portas não significa que os módulos de OS/estoque/fiscal já operem nativamente neles.
- Existe um **núcleo assíncrono independente** (`async-workshop-services.js`) para clientes, veículos, OS, peças, movimentações de estoque, pagamentos e resumo financeiro, com entradas experimentais PostgreSQL localhost e Worker D1. Seus comandos não usam SQLite legado. Os testes reais de PostgreSQL 16 e Workerd/D1 local são executados no GitHub Actions sem conectar dados de clientes ou infraestrutura paga.
- **Paridade parcial:** as interfaces completas de orçamento/fiscal, autenticação/RBAC, relatórios, anexos e aplicação desktop/PWA ainda dependem do runtime legado. Não dirigir clientes ao backend nativo experimental como se fosse sistema completo.

## Pendências técnicas para declarar implementação integral

- Banco PostgreSQL e Cloudflare D1: núcleo operacional assíncrono e testes contra PostgreSQL 16 real / D1 local já implementados; ainda falta adaptar todas as rotas, login, RBAC, anexos, fiscal, domínio completo e a UI, com paridade E2E no backend selecionado. Sem fallback disfarçado.
- Arquivos MinIO/R2: anexos novos e PDFs anexados já têm backend S3 primário opcional. Faltam política de retenção, varredura de órfãos, restore remoto testado e cópia automatizada dos objetos legados.
- Compartilhamento entre filiais: catálogos, clientes, estoque e continuidade operacional de OS com dossiê de evidências e livros preservados na origem. Não é uma migração de titularidade fiscal nem transação distribuída. Sincronização contínua, compensação automática e automatização da análise LGPD seguem pendentes.
- Relatórios consolidados da empresa, testes completos de carga, restore do conjunto e QA E2E da UI no Linux.
- Nenhum merge/deploy sem gates aprovados e revisão de isolamento.
