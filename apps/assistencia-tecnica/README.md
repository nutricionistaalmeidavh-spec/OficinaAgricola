# ArtiSys Assistência Técnica

Versão separada do sistema de oficina, mantida no mesmo repositório sem substituir nem alterar a aplicação Oficina Agrícola existente.

## Isolamento

- aplicação: `apps/assistencia-tecnica/`;
- porta padrão: `3344`;
- banco local: `data/assistencia-tecnica.sqlite`;
- anexos: `storage/assistencia-tecnica/uploads/`;
- Electron: `%LOCALAPPDATA%/ArtiSys/AssistenciaTecnica`;
- appId: `com.artisys.assistenciatecnica`;
- instalador e atalho próprios.

O sistema original continua na raiz do repositório e não depende desta aplicação.

## Princípios

- core R$ 0;
- self-hosted;
- funcionamento local/offline;
- SQLite local;
- nenhuma API ou SaaS pago obrigatório;
- serviços pagos, se adicionados futuramente, devem permanecer opcionais.

## Entregas 00–08

### 00 — Proteção

A versão estável anterior foi preservada em branch de backup antes da criação desta edição. O desenvolvimento ocorre em branch separada.

### 01 — Estrutura isolada

Aplicação independente dentro do mesmo repositório, com banco, configuração, porta, identidade Electron/PWA e instalador próprios.

### 02 — Cadastros

Clientes, equipamentos, técnicos, peças e catálogo de serviços com preço padrão e tempo estimado.

### 03 — Ordens de serviço

Criação, edição, consulta, histórico e fluxo auditável de status da entrada até a entrega.

### 04 — Execução técnica

Diagnóstico, checklists, fotos/anexos, peças consumidas, observações e acompanhamento técnico vinculados à OS.

### 05 — Orçamentos

Itens de peça, mão de obra e terceiros, desconto, validade, aprovação/reprovação e conversão do fluxo para execução.

### 06 — Estoque

Entradas, saídas, ajustes, consumo por OS, alerta de mínimo e baixa automática de peças em vendas de balcão. Cancelamento de venda estorna o estoque de forma auditável.

### 07 — Caixa e vendas

Venda de peças e serviços, cliente opcional, desconto, formas de pagamento, abertura/fechamento de caixa, suprimento, sangria, ajuste e estorno.

### 08 — Documentos

OS, orçamento, entrega e recibo imprimíveis/PDF, além da visão de relatórios operacionais e financeiros já integrada à aplicação isolada.

## Execução local

```bash
cd apps/assistencia-tecnica
cp .env.example .env
npm run db:migrate
npm run db:seed
npm start
```

Abra `http://127.0.0.1:3344`.

Para uso em tablet/celular na mesma rede, mantenha `HOST=0.0.0.0` e acesse `http://IP-DO-COMPUTADOR:3344`.

## Testes

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

O teste adicional `tests/assistencia-sales.test.js` cobre catálogo de serviços, venda de balcão, baixa de estoque, estorno e fechamento de caixa.
