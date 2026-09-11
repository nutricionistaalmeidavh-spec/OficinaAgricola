# ArtiSys Oficina Agrícola

Sistema self-hosted para oficinas de máquinas agrícolas e pesadas. Esta V1 cobre as Entregas **00–06**: base/autenticação, cadastros, ordens de serviço, orçamento/documentos, peças/estoque, agenda/checklists/anexos e financeiro.

## Princípios desta versão

- núcleo **R$ 0**, self-hosted e sem serviço SaaS obrigatório;
- banco SQLite local e armazenamento local de anexos;
- funciona sem internet depois de instalado;
- interface responsiva para desktop e celular na mesma rede;
- regras críticas auditáveis: status da OS, estoque e recebimentos não são apagados para “corrigir histórico”;
- nenhuma alteração no PDV ArtiSys existente.

## Requisitos

- Node.js **22.16 ou superior**;
- Windows, macOS ou Linux com permissão de escrita nas pastas de dados;
- navegador moderno.

> Em Node 22, `node:sqlite` pode exibir um `ExperimentalWarning`. A API usada nesta versão é coberta pela suíte de testes do projeto. A decisão arquitetural está documentada em `docs/architecture/0001-zero-dependency-core.md`.

## Primeira execução

```bash
cp .env.example .env
npm run db:migrate
npm run db:seed
npm start
```

Acesse `http://127.0.0.1:3333`.

Antes de usar em produção, altere `ADMIN_PASSWORD` no `.env`. Em `NODE_ENV=production`, o seed exige senha administrativa informada explicitamente e não cria credencial padrão silenciosa.

### Uso em celular na rede local

No `.env`:

```env
HOST=0.0.0.0
PORT=3333
```

Abra no celular `http://IP-DO-COMPUTADOR:3333`. O computador servidor precisa permanecer ligado e a porta deve estar permitida no firewall da rede local.

## Perfis

- `ADMIN`: acesso geral, usuários, configurações e autorizações críticas;
- `ATENDIMENTO`: clientes, máquinas e operação de OS;
- `TECNICO`: consulta/operação técnica conforme rotas permitidas;
- `FINANCEIRO`: recebimentos, despesas e visão financeira.

## Entregas implementadas

### 00 — Base

Autenticação local com senha protegida por `scrypt`, sessões persistidas por hash, configurações da empresa, healthcheck, migrations e seed.

### 01 — Cadastros

Clientes, máquinas vinculadas ao proprietário e técnicos. Registros com histórico são inativados em vez de removidos fisicamente.

### 02 — Ordens de serviço

Fluxo auditável:

```text
ENTRADA → DIAGNOSTICO → ORCAMENTO → AGUARDANDO_APROVACAO
→ APROVADA → EM_SERVICO → PRONTA → ENTREGUE
```

Também existem `CANCELADA` e `REPROVADA` conforme as regras de transição.

### 03 — Orçamento e documentos

Múltiplos itens de peça, mão de obra e terceiros; desconto; aprovação/reprovação; documentos imprimíveis de orçamento, OS, entrega e recibo.

### 04 — Peças e estoque

Cadastro de peças, entrada, saída manual, consumo em OS, ajuste, estorno e alerta de estoque mínimo. Movimentações permanecem auditáveis.

### 05 — Agenda, checklist e anexos

Agenda por cliente/OS/técnico, modelos de checklist com resposta por item (`OK`, `ATENCAO`, `NAO_SE_APLICA`) e fotos/PDFs armazenados localmente.

### 06 — Financeiro

Recebimentos parciais/totais por OS, estorno auditável, despesas e resumo por período com faturado, recebido, pendente, despesas e resultado simples.

## Backup

Faça backup conjunto do banco e dos anexos:

```text
data/oficina.sqlite
storage/uploads/
```

Para cópia manual consistente, pare o processo da aplicação, copie os dois caminhos e inicie novamente. Restauração deve usar banco e pasta de anexos da mesma data.

## Testes e build

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

O `test:e2e` percorre via HTTP o fluxo crítico completo: login, cliente, máquina, OS, diagnóstico, orçamento, aprovação, estoque, checklist/anexo, conclusão, pagamento, entrega e histórico.

## Build

`npm run build` gera `dist/` contendo servidor, interface e código necessário para execução. Banco e anexos não entram no build.

## Fora desta fase

Não são dependências da V1: NF-e/NFS-e, integração bancária/Open Finance, WhatsApp automático, IA, aplicativo móvel nativo, multiempresa avançada e portal externo do cliente.
