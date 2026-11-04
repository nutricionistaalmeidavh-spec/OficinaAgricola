# ArtiSys Oficina — modo multiempresa (branch experimental)

## Estado real

- Implementado: registro central de empresas, unidades e vínculos; autenticação central; RBAC por unidade; gateway HTTP que encaminha toda rota operacional autorizada para SQLite exclusivo e diretório de uploads exclusivo da unidade.
- Implementado: migração aditiva dos usuários legados (Matriz 1/1 preservada), painel de cadastro de empresas/unidades/vínculos, seletor, revogação, isolamento da fila offline por unidade, links públicos de aprovação vinculados à unidade e backups verificados de registro e unidades.
- **Implementado na branch:** storage S3 para novos anexos/PDFs anexados (MinIO/R2 opcional), emissor fiscal por empresa com CNPJ fixado, transferência controlada de OS em estágio inicial e portas SQL assíncronas nativas para desenvolvimento PostgreSQL/D1. **Ainda pendente:** migração dos módulos operacionais a PostgreSQL/D1, transferência de OS com vínculos financeiros/fiscais/estoque e anexos existentes, sincronização contínua e restauração remota automática. O backend SQLite/disco continua sendo o core R$ 0.
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

## Transferência de OS entre filiais: estágio inicial seguro

- `POST /api/tenancy/os-transfer` recebe `sourceUnitId`, `targetUnitId`, `workOrderId`, `legalBasis`, `recordReference`, `requestId`. Requer ADMIN nas duas unidades da mesma empresa.
- Apenas OS em `ENTRADA` ou `DIAGNOSTICO` **sem** orçamento, baixa de estoque, recebimentos, despesas, documentos fiscais, anexos, agenda ou checklists podem ser transferidas pelo fluxo atual.
- O serviço cria novos IDs locais para cliente/veículo/OS no destino, sem copiar notas privadas, persiste referência da origem, cancela a OS original e registra auditoria. A intenção durável permite retry via `POST /api/tenancy/os-transfer/retry` com `transferId`, evitando duplicidade.
- **Não atende ainda à transferência de uma OS complexa completa** com orçamento aprovado, pagamentos, documentos fiscais, itens de estoque e anexos. Esses vínculos precisam de preservação de evidências, trilha fiscal e livro contábil, sem duplicação automática.

## Portas SQL assíncronas nativas (fase de migração)

- `src/platform/async-sql-ports.js` disponibiliza portas PostgreSQL (com pool do driver OSS `pg` injetado) e Cloudflare D1 (binding nativo de Worker) para consultas parametrizadas, execuções e transações suportadas.
- PostgreSQL oferece `BEGIN/COMMIT/ROLLBACK` por conexão; D1 oferece `batch` atômico. D1 não permite simular transações interativas de múltiplas chamadas; a porta falha explicitamente nesses casos.
- **O domínio principal ainda usa `DatabaseSync` síncrono**. Não ativar PostgreSQL/D1 como armazenamento canônico até migrar serviços, migrações SQL, identidade, outbox e testes com bancos reais. A existência dessas portas não significa que os módulos de OS/estoque/fiscal já operem nativamente neles.

## Pendências técnicas para declarar implementação integral

- Banco PostgreSQL e Cloudflare D1: portas assíncronas parametrizadas estão prontas para receber drivers nativos, mas **falta adaptar cada serviço, as migrações e testes de integração com instâncias reais**. Nunca alegar armazenamento primário concluído.
- Arquivos MinIO/R2: anexos novos e PDFs anexados já têm backend S3 primário opcional. Faltam política de retenção, varredura de órfãos, restore remoto testado e cópia automatizada dos objetos legados.
- Compartilhamento entre filiais: cópia manual auditada e idempotente de peças (estoque inicial zero) e contatos básicos de clientes (sem notas privadas, com base legal e referência obrigatórias). Transferência manual de estoque agora registra saída/entrada canônicas com intenção persistida e retomada por ID; não é transação distribuída. ADMIN em ambas as unidades. Transferência integral de OS com vínculos financeiros/fiscais e anexos, sincronização contínua e automatização da base legal permanecem pendentes.
- Relatórios consolidados da empresa, testes completos de carga, restore do conjunto e QA E2E da UI no Linux.
- Nenhum merge/deploy sem gates aprovados e revisão de isolamento.
