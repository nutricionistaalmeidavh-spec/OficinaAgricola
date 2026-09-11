# Oficina Agrícola — V1 (Entregas 00–06)

Data: 2026-09-11

## Objetivo

Criar uma versão independente do sistema ArtiSys voltada a oficinas de máquinas agrícolas e pesadas, pronta para operar o fluxo real de uma oficina sem depender do PDV existente.

O escopo desta fase cobre as Entregas 00–06: base isolada, cadastros, ordens de serviço, orçamento e documentos operacionais, estoque/peças, agenda/checklist/fotos e financeiro.

## Restrições

- Repositório e banco próprios; nenhuma alteração no PDV existente.
- Núcleo R$ 0, self-hosted e open source.
- Nenhum SaaS ou serviço pago como dependência obrigatória.
- Interface responsiva, utilizável em desktop e celular.
- Arquitetura preparada para empacotamento desktop futuro sem acoplar a regra de negócio ao Electron.
- Dados persistentes em SQLite no modo local/self-hosted.
- Operações críticas devem ser testáveis sem internet.

## Stack recomendada

- Frontend: React + TypeScript + Vite.
- UI: componentes próprios sobre CSS/Tailwind; sem dependência visual paga.
- Backend: Node.js + TypeScript + Fastify.
- Banco: SQLite.
- Acesso a dados: Drizzle ORM.
- Validação: Zod.
- Testes: Vitest para domínio/API e Playwright para fluxos críticos.
- Documentos: geração local de HTML/PDF imprimível, sem API externa.

A aplicação será organizada em monorepo simples, separando interface, API e domínio compartilhado.

## Estrutura

```text
OficinaAgricola/
├── apps/
│   ├── web/                 # React/Vite
│   └── api/                 # Fastify
├── packages/
│   ├── domain/              # regras, tipos e validações
│   ├── database/            # schema, migrations e repositories
│   └── ui/                  # componentes reutilizáveis
├── tests/
│   ├── integration/
│   └── e2e/
├── docs/
└── package.json
```

## Entrega 00 — Base isolada

### Resultado

Aplicação executável em desenvolvimento com frontend, API e banco local independentes.

### Inclui

- estrutura de monorepo;
- configuração TypeScript;
- variáveis de ambiente exemplificadas em `.env.example`;
- SQLite e migrations;
- healthcheck da API;
- seed inicial;
- tratamento padronizado de erros;
- scripts `dev`, `build`, `test`, `lint` e `db:migrate`;
- layout principal responsivo;
- navegação lateral/compacta;
- configurações básicas da empresa;
- usuários e perfis `ADMIN`, `ATENDIMENTO`, `TECNICO` e `FINANCEIRO`;
- autenticação local por usuário/senha com hash seguro.

## Entrega 01 — Cadastros

### Clientes

Campos principais:
- nome/razão social;
- CPF/CNPJ;
- telefone;
- e-mail;
- endereço;
- observações;
- ativo/inativo.

### Máquinas

Campos principais:
- cliente proprietário;
- tipo;
- marca;
- modelo;
- ano;
- número de série;
- identificação interna/placa quando aplicável;
- horímetro;
- observações;
- ativo/inativo.

### Técnicos

Campos principais:
- nome;
- telefone;
- especialidade;
- usuário associado opcionalmente;
- ativo/inativo.

A tela do cliente exibirá suas máquinas e a tela da máquina será a origem do histórico de manutenção.

## Entrega 02 — Ordem de Serviço

### Estados da OS

```text
ENTRADA
→ DIAGNOSTICO
→ ORCAMENTO
→ AGUARDANDO_APROVACAO
→ APROVADA
→ EM_SERVICO
→ PRONTA
→ ENTREGUE
```

Estados adicionais: `CANCELADA` e `REPROVADA`.

### Dados

- número sequencial da OS;
- cliente;
- máquina;
- data/hora de entrada;
- problema relatado;
- diagnóstico;
- técnico responsável;
- previsão de entrega;
- prioridade;
- observações internas;
- status;
- data/hora de conclusão e entrega.

Toda mudança de status relevante registra data/hora para formar histórico auditável.

## Entrega 03 — Orçamento e documentos operacionais

### Orçamento

Cada OS pode receber:
- itens de peças;
- serviços/mão de obra;
- serviços de terceiros;
- desconto;
- subtotal;
- total;
- observações;
- validade;
- situação de aprovação.

A aprovação altera a OS para `APROVADA`; a reprovação registra motivo e muda para `REPROVADA`.

### Documentos

Geração local e imprimível de:
- orçamento;
- ordem de serviço;
- resumo de entrega;
- recibo simples.

Os documentos mostram dados da empresa, cliente, máquina, OS, itens e totais aplicáveis.

## Entrega 04 — Peças e estoque

### Cadastro de peças

- código/SKU;
- descrição;
- categoria;
- unidade;
- custo;
- preço de venda;
- quantidade atual;
- estoque mínimo;
- localização;
- ativo/inativo.

### Movimentações

Tipos:
- entrada;
- saída manual;
- consumo em OS;
- estorno;
- ajuste.

Adicionar peça a uma OS aprovada/em serviço gera consumo de estoque. Remoção/estorno devolve quantidade de forma auditável.

Não será permitido saldo negativo sem confirmação explícita de usuário com permissão administrativa.

## Entrega 05 — Agenda, checklist e fotos

### Agenda

Eventos vinculáveis a cliente, máquina, OS e técnico:
- diagnóstico;
- execução;
- visita;
- previsão de entrega;
- retorno.

### Checklist

Checklists por OS com itens configuráveis e respostas:
- OK;
- atenção;
- não se aplica;
- observação.

O sistema terá modelos iniciais para entrada e entrega, mantendo possibilidade de edição local.

### Fotos/anexos

Fotos vinculadas à OS com:
- categoria `ENTRADA`, `DIAGNOSTICO`, `SERVICO`, `ENTREGA` ou `OUTRO`;
- legenda;
- data/hora;
- referência à OS.

Arquivos serão mantidos localmente no armazenamento configurado pela aplicação; o banco guardará apenas metadados e caminhos controlados.

## Entrega 06 — Financeiro

### Recebimentos por OS

- total da OS;
- valor recebido;
- saldo pendente;
- forma de pagamento;
- data do recebimento;
- observação;
- situação `PENDENTE`, `PARCIAL` ou `PAGO`.

Uma OS pode ter vários recebimentos.

### Despesas

- descrição;
- categoria;
- valor;
- vencimento;
- pagamento;
- centro de referência opcional;
- OS vinculada opcionalmente.

### Visão financeira

- faturamento do período;
- recebimentos;
- valores pendentes;
- despesas;
- resultado simples;
- filtros por período.

Esta fase não inclui integração bancária, emissão fiscal ou conciliação automática.

## Dashboard V1

O dashboard deriva dados reais do banco e exibe:
- OS abertas;
- em diagnóstico;
- aguardando aprovação;
- em serviço;
- prontas;
- faturamento do período;
- agenda próxima;
- estoque abaixo do mínimo.

## Regras de integridade

- Cliente não é removido fisicamente se possuir máquina ou OS; é inativado.
- Máquina não é removida fisicamente se possuir OS; é inativada.
- OS finalizada mantém snapshot dos valores relevantes para evitar alterações históricas acidentais.
- Movimentações de estoque e recebimentos são registros auditáveis; correções usam estorno/ajuste.
- Exclusões destrutivas críticas exigem perfil `ADMIN` e confirmação.
- Senhas nunca são armazenadas em texto puro.

## Fluxo crítico de aceitação

O sistema só é considerado operacional quando passar integralmente:

```text
Cadastrar cliente
→ cadastrar máquina
→ abrir OS
→ registrar diagnóstico
→ montar orçamento
→ aprovar orçamento
→ adicionar mão de obra e peças
→ baixar estoque
→ registrar checklist e fotos
→ concluir serviço
→ gerar OS/orçamento/recibo
→ registrar pagamento
→ entregar máquina
→ consultar histórico completo da máquina
```

## Testes

### Domínio/API

Cobrir no mínimo:
- transições válidas e inválidas da OS;
- cálculo de orçamento;
- baixa e estorno de estoque;
- pagamentos parciais e totais;
- permissões;
- integridade de cliente/máquina/OS.

### E2E

Playwright cobrirá o fluxo crítico de aceitação e cenários de regressão principais.

Validação visual poderá ser adicionada de forma opcional; não será dependência obrigatória do pipeline padrão.

## Fora do escopo desta fase

- emissão NF-e/NFS-e;
- Open Finance;
- WhatsApp automático;
- IA;
- aplicativo móvel nativo;
- multiempresa avançada;
- BI avançado;
- portal externo do cliente;
- serviços pagos obrigatórios.

## Critério de conclusão das Entregas 00–06

1. `build`, `lint` e testes passam sem erro.
2. Banco pode ser criado do zero por migration.
3. Seed fornece usuário administrador e dados demonstrativos sem credenciais inseguras fixas em produção.
4. Fluxo crítico E2E passa.
5. Aplicação pode operar localmente/self-hosted sem internet.
6. Nenhuma dependência paga é necessária para funcionamento do núcleo.
