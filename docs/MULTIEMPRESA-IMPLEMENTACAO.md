# ArtiSys Oficina — modo multiempresa (branch experimental)

## Estado real

- Implementado: registro central de empresas, unidades e vínculos; autenticação central; RBAC por unidade; gateway HTTP que encaminha toda rota operacional autorizada para SQLite exclusivo e diretório de uploads exclusivo da unidade.
- Implementado: migração aditiva dos usuários legados (Matriz 1/1 preservada), painel de cadastro de empresas/unidades/vínculos, seletor, revogação, isolamento da fila offline por unidade, links públicos de aprovação vinculados à unidade e backups verificados de registro e unidades.
- **Ainda não implementado:** motor PostgreSQL/D1 e armazenamento R2/MinIO como backend primário, sincronização contínua interunidades, transferência de OS e integração fiscal multiempresa. Existe replicação **opcional de backups verificados** para MinIO/R2, mas os dados operacionais permanecem no SQLite/disco. Transferências manuais de estoque passam por protocolo de retomada, sem transação SQL distribuída.
- A main continua usando o modo legado. O modo multiempresa é opt-in e depende de revisão.
- Resumo gerencial autorizado entre unidades da mesma empresa: quantidades operacionais e consolidação financeira por livro de pagamentos e despesas efetivamente pagas. Não substitui contabilidade, apuração fiscal ou conciliação bancária.
- Se o banco antigo tiver ordens de serviço com unit_id diferente da Matriz (1), o gateway **recusa iniciar** até executar migração específica e auditada. Nunca reatribui as OS para a Matriz silenciosamente.

## Provedores configuráveis com falha explícita

O runtime atual aceita exclusivamente `OFICINA_DATABASE_ENGINE=sqlite` e `OFICINA_OBJECT_STORAGE=disk` (ambos padrões). Solicitar `postgres`, `d1`, `minio` ou `r2` encerra a inicialização com erro. Esse bloqueio evita aparentar uso de serviços em nuvem enquanto grava informações no disco local. Implementar adaptadores assíncronos e validar contratos é requisito para suportar esses provedores.

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

O core mantém SQLite e anexos no disco, ambos 100% self-hosted. A replicação S3 **não muda o banco operacional nem o caminho usado para ler anexos**, portanto não substitui um adaptador de armazenamento de objetos para o sistema inteiro.

- Configure `OFICINA_BACKUP_S3_ENDPOINT`, `OFICINA_BACKUP_S3_BUCKET`, `OFICINA_BACKUP_S3_REGION`, `OFICINA_BACKUP_S3_PREFIX`, `OFICINA_BACKUP_S3_ACCESS_KEY_ID`, `OFICINA_BACKUP_S3_SECRET_ACCESS_KEY` no ambiente privado do serviço. Todas são opcionais; sem endpoint, nenhuma requisição remota ocorre.
- Endpoint HTTPS obrigatório fora de loopback; MinIO local em `http://127.0.0.1:9000` é aceito para laboratório. MinIO é open source e pode ser executado pelo cliente. Cloudflare R2 é uma alternativa explícita, sujeita ao preço e limites próprios.
- Cada backup local é criado com snapshot SQLite consistente e validado antes do envio. O cliente S3 usa AWS SigV4 sem dependências NPM adicionais, assina o SHA-256, faz PUT dos arquivos e HEAD para conferir metadados de integridade e tamanho. O `manifest.json` é enviado por último.
- Se o storage externo falhar, o backup local permanece intacto e a próxima execução pode repetir o upload do mesmo arquivo de backup. As credenciais nunca são incluídas em logs ou commits.
- **Limitações:** não há backup remoto contínuo, versão retida/expirada remotamente ou restauração remota automática. É necessário testar a restauração manual com arquivos recuperados do bucket; o bucket deve ser privado, com controle próprio de acesso e redundância.

## Pendências técnicas para declarar implementação integral

- Banco PostgreSQL e Cloudflare D1: reescrever interface síncrona DatabaseSync para repositórios assíncronos com compatibilidade transacional, testes de paridade, concorrência e regressão; não há adaptação segura sem isso.
- Arquivos MinIO/R2: replicação opcional de backups completos já implementada, mas faltam adaptadores primários de upload, leitura, PDFs e anexos, ciclo de vida/expiração e restore remoto.
- Compartilhamento entre filiais: cópia manual auditada e idempotente de peças (estoque inicial zero) e contatos básicos de clientes (sem notas privadas, com base legal e referência obrigatórias). Transferência manual de estoque agora registra saída/entrada canônicas com intenção persistida e retomada por ID; não é transação distribuída. ADMIN em ambas as unidades. Transferência de OS, sincronização contínua e automatização da base legal permanecem pendentes.
- Relatórios consolidados da empresa, testes completos de carga, restore do conjunto e QA E2E da UI no Linux.
- Nenhum merge/deploy sem gates aprovados e revisão de isolamento.
