# PostgreSQL 16 embarcado no instalador Windows (PR #32 — P5 em validação)

## Regra de produto: zero terminal no cliente

O usuário final **não** instala Node, npm, pg, PostgreSQL, pgAdmin, ACBr ou
serviços pagos. O instalador NSIS x64 contém tudo o que precisa para uma
instalação desktop offline. O primeiro clique no ArtiSys Oficina inicializa
um cluster PostgreSQL 16 privado automaticamente.

A operação normal é:

1. Executar \`ArtiSys-Oficina-Setup-*-Windows-x64.exe\`;
2. instalar o aplicativo (per-user, sem instalar outro PostgreSQL global);
3. abrir o atalho ArtiSys Oficina;
4. o Electron verifica hashes de \`resources/postgresql\`, cria o cluster
   PostgreSQL privado, gera credencial aleatória, configura autenticação
   SCRAM-SHA-256 e cria \`oficina_registry\` e \`oficina_operations\`;
5. o backend PostgreSQL abre em loopback e a interface solicita o
   cadastro do administrador;
6. nas próximas aberturas o mesmo banco e senha são reutilizados.
   Nunca recriar um cluster quando a pasta/identidade existente foi perdida.

O PostgreSQL é um **processo da instalação**, não um serviço Windows global;
não ocupa a porta de outra instância do PostgreSQL já presente no sistema.
Ele só aceita conexões em \`127.0.0.1\`, usa uma porta escolhida e persistida,
e inicia/encerra junto com o Oficina (quando a sessão estiver sob controle).
O core é open source/self-hosted e sem SaaS obrigatório.

### Caminhos do Windows

| Componente | Local |
|---|---|
| Binários PostgreSQL | \`<Instalação>/resources/postgresql/\` (somente leitura) |
| Banco de dados privado | \`%LOCALAPPDATA%/ArtiSys/Oficina/postgres/cluster/\` |
| Credencial local | \`%LOCALAPPDATA%/ArtiSys/Oficina/postgres/connection.json\` |
| Arquivos e anexos | \`%LOCALAPPDATA%/ArtiSys/Oficina/storage/postgres/\` |
| ACBr local | \`<Instalação>/resources/fiscal/\` |
| Configuração fiscal | \`%LOCALAPPDATA%/ArtiSys/Oficina/fiscal/\` |

Nunca adicionar \`connection.json\` ao Git, cache do frontend, arquivos
exportados de suporte ou logs de erro. A senha é criada localmente, com
permissão de acesso privada herdada do perfil do Windows.

## Montagem do instalador — apenas builder/CI

- O builder Windows obtém PostgreSQL 16 de distribuição OSS e executa
  \`node scripts/stage-postgres-windows.mjs\`.
- O staging copia \`bin/\`, \`lib/\` e \`share/\`, gera hashes SHA-256,
  valida \`initdb.exe\`, \`pg_ctl.exe\`, \`postgres.exe\`, \`psql.exe\`,
  e registra \`postgresql-bundle.json\` em \`build/postgresql/\`.
- O electron-builder NSIS incorpora \`build/postgresql/\` como
  \`resources/postgresql/\`, idêntico ao padrão dos componentes ACBr.
- Somente o **computador de build** roda \`npm ci\`, Chocolatey
  ou \`electron-builder\`. O cliente não executa esses comandos, não
  precisa de internet nem fornece credenciais para a ArtiSys.
- O workflow Windows verifica, após instalar o NSIS em VM descartável,
  o cluster privado, login, CRUD, integridade e persistência após reabrir.

**Não ativar automaticamente no build publicado até o smoke Windows passar.**

Na branch, o modo está isolado sob
\`OFICINA_POSTGRES_DESKTOP_MODE=enabled\`; o desktop legado permanece
funcional até a migração completa de P3/P4 e os gates P5–P8.

## Recuperação, atualização e isolamento

- O cluster é mantido fora do diretório do instalador, logo uma atualização
  do executável não deve substituí-lo.
- Binário novo não pode executar \`initdb\` em uma pasta existente.
- Um cluster sem credenciais válidas, banco faltando ou versões major
  incompatíveis é uma **falha de recuperação**; o sistema deve bloquear
  abertura em vez de criar um banco vazio.
- Cada unidade usa um schema PostgreSQL isolado, vinculado
  imutavelmente no registry; as autorizações são verificadas por sessão.
- ACBr continua desabilitado para emissão fiscal até configuração legal
  e autorização explícitas.
- Serviço pago de hospedagem, PostgreSQL gerenciado, D1, R2 ou S3 é
  opcional e não integra a instalação básica.

## Gates ainda obrigatórios

- Teste de Windows real sem permissões administrativas/elevadas, e caminho
  de instalação per-user limpo.
- Smoke de instalação, primeira abertura, fechamento e reabertura, inclusive
  ACL das credenciais e ausência de PostgreSQL externo.
- Backup/restauração PostgreSQL completa, anexos, updates incrementais,
  falha durante initdb e recuperação após queda de energia.
- Migração auditada dos dados SQLite existentes para os novos bancos,
  com opção segura de rollback.
- Paridade de fluxos fiscais, de diagnóstico/OBD, relatórios e todos os
  endpoints operacionais, além da UI Electron.
- Aprovação dos checks no SHA final; PR permanece Draft, sem merge/deploy.

Fonte e licença PostgreSQL: https://www.postgresql.org/about/licence/
Binários Windows oficiais: https://www.postgresql.org/download/windows/
