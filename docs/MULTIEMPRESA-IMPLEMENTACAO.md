# ArtiSys Oficina — modo multiempresa (branch experimental)

## Estado real

- Implementado: registro central de empresas, unidades e vínculos; autenticação central; RBAC por unidade; gateway HTTP que encaminha toda rota operacional autorizada para SQLite exclusivo e diretório de uploads exclusivo da unidade.
- Implementado: migração aditiva dos usuários legados (Matriz 1/1 preservada), painel de cadastro de empresas/unidades/vínculos, seletor, revogação, isolamento da fila offline por unidade, links públicos de aprovação vinculados à unidade e backups verificados de registro e unidades.
- **Ainda não implementado:** motor PostgreSQL, D1, armazenamento R2/MinIO, sincronização interunidades, catálogo compartilhado e consolidação financeira global. NÃO declarar multibackend pronto para produção.
- A main continua usando o modo legado. O modo multiempresa é opt-in e depende de revisão.
- Resumo operacional autorizado entre unidades da mesma empresa já implementado, sem confundir contagens com consolidação fiscal/contábil.
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

## Pendências técnicas para declarar implementação integral

- Banco PostgreSQL e Cloudflare D1: reescrever interface síncrona DatabaseSync para repositórios assíncronos com compatibilidade transacional, testes de paridade, concorrência e regressão; não há adaptação segura sem isso.
- Arquivos MinIO/R2: conectar provedores S3 compatíveis a uploads, PDFs, anexos, expiração e backups; disco local já funciona.
- Compartilhamento aprovado entre filiais: clientes e catálogo de peças comuns, transferência de OS e estoque com auditoria e autorização explícita. Hoje cada unidade tem dados operacionais independentes.
- Relatórios consolidados da empresa, testes completos de carga, restore do conjunto e QA E2E da UI no Linux.
- Nenhum merge/deploy sem gates aprovados e revisão de isolamento.
