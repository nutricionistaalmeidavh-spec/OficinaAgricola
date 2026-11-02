# ADR-0002 — Contrato canônico do ArtiSys Oficina
Status: **adotado como contrato de desenvolvimento; implantação parcial nesta branch**.
Data: 2026-11-02.
Escopo: único sistema Node.js + SQLite + HTML/JS vanilla, offline/local-first, core self-hosted R$ 0.

## 1. Princípio inegociável

Uma entidade de domínio tem uma única fonte gravável e uma única autoridade de transição.
**Não existem dois bancos canônicos, nem dois autores independentes do mesmo status/saldo.**
A interface **não é** uma fonte de verdade. Dados derivados podem ser materializados por desempenho,
mas somente sob uma regra de recomposição e teste de reconciliação.

É proibido:
- fazer escrita SQL no navegador, seletor, renderer ou `GET`;
- alterar status da OS fora do serviço canônico de transição;
- criar lançamento de caixa e recebimento da mesma operação sem referência e deduplicação;
- registrar baixa de estoque em dois fluxos distintos sem reconciliação;
- refazer `#content.innerHTML` após toda operação sem necessidade;
- sobrescrever `navigate`, `renderMachines`, `openWorkOrder` ou `workOrderModal` por monkey patch;
- refazer tela/modal com formulário sujo ou descartar resposta concorrente sem checagem da navegação;
- criar dependência obrigatória de SaaS/API paga para o funcionamento local;
- alterar modelo, login, credenciais e arquivos sensíveis sem testes específicos.

## 2. Matriz de propriedade dos dados

| Entidade | Fonte gravável | Único escritor / autoridade | Derivações e leituras | Invariantes |
| --- | --- | --- | --- | --- |
| Cliente | `customers` | `src/services/catalog.js` | `work_orders.snapshot_customer` é fotografia histórica | OS aponta para cliente existente; foto não reescreve cadastro |
| Equipamento / veículo | `machines` | `src/services/catalog.js` | `snapshot_machine` e histórico de OS são leituras | Vínculo com proprietário; não renomear o item histórico pelo cadastro atual |
| Ordem de Serviço | `work_orders` | `src/services/work-orders.js` | `work_order_status_history` e `work_order_change_history` auditam | Transição validada em `domain.js`; status/histórico na mesma transação |
| Orçamento | `quotes`, `quote_items` | `src/services/quotes.js` | `work_orders.quote_total_cents` é cópia do total **aprovado** | Cálculo em centavos; aprovado é imutável; aprovação atualiza OS atomicamente |
| Estoque disponível | `parts.quantity` **(atual)** | `inventory.js` para OS/movimento; `sales.js` para balcão | `inventory_movements` + `sale_stock_movements` auditam por caminhos diferentes | Nenhum saldo negativo indevido; dois livros ainda exigem reconciliação para torná-los um livro canônico |
| Venda de balcão | `sales`, `sale_items` | `src/services/sales.js` | `request_id`/hash protege reenvio; movimentos vinculados à venda | Venda, baixa e caixa atômicos; idempotência; estorno único |
| Caixa | `cash_sessions`, `cash_movements` | `src/services/sales.js` | Saldo esperado por soma dos movimentos, não pelo DOM | Um caixa aberto; fechamento histórico preservado; estorno no caixa corrente |
| Recebimento de OS | `receipts` | `src/services/finance.js` | `paymentSummary` deriva de orçamento aprovado − recebimentos ativos | Não confundir com venda de balcão; eventual integração precisa ID único para impedir crédito em duplicidade |
| Despesa | `expenses` | `src/services/finance.js` | Somatórios são consultas derivadas | Sem lançamento automático adicional de caixa até existir vínculo canônico |
| Agenda / checklist | `schedule_events`, `work_order_checklists` | `src/services/operations.js` | Visões por OS e técnico | Checklist é registro finalizado, não autoriza alteração de OS por fora |
| Anexos | `attachments` e arquivos locais | `src/services/operations.js` | Modal e PDFs consultam os dados existentes | Guardar referência e validar integridade/arquivo |
| Usuários e sessões | `users`, `sessions` | `src/auth.js` e rotas administrativas | `state.user` é só representação da sessão | Senhas são hashes; papéis no servidor, nunca só na UI |

**ATENÇÃO — não confundir contrato com implementação concluída**: inventário e recebimentos/caixa
ainda têm mais de um fluxo de escrita. A remoção desses dois débitos exige migração aditiva e
testes, não simples exclusão de tabelas. Proibido contabilizar dois livros como se fossem um só.

## 3. Contrato de comando e consulta (CQRS leve, sem biblioteca)

- **Comando:** entrada `POST`/`PATCH`/`PUT` → rota validada → serviço autoritativo → `transaction(db,...)` → mudança atômica + histórico → resposta contendo os IDs e versão/evento necessários à UI.
- **Consulta:** `GET` → query sem efeitos colaterais → projeção somente leitura → UI. Nenhum `GET` emite evento de domínio de alteração.
- Para operações repetíveis, usar `requestId`/chave única e validação de fingerprint no servidor.
- Valores monetários em **centavos inteiros**; quantidade como número validado, nunca texto formatado.
- Histórico/status/auditoria append-only quando necessário; nunca apagar histórico para "sincronizar tela".
- Dados de apresentação (`kpis`, quantidade de vendas, resumo financeiro) são derivados de registros canônicos.

## 4. Protocolo de UI (sem rerender destrutivo)

A interface atual é JS vanilla, **não React**; "rerender" significa trocar a árvore DOM com
`innerHTML`/`setContent` ou recriar modais após operações.

1. Há um único `navigate(page)` em `app-core.js`; serviços/caixa são entradas do mesmo roteador.
2. Clique repetido na página atual **não recarrega a árvore DOM**. O botão Atualizar é exceção explícita.
3. Ao navegar, abortar `GET` pendentes; respostas de navegação anterior não podem substituir a tela atual.
4. Não sobrescrever funções globais de renderização entre arquivos; recursos complementares usam funções dedicadas chamadas pelo fluxo dono.
5. Renderização integral permitida **apenas** no primeiro acesso a uma página e em atualização explícita.
6. Após comandos, atualizar somente os nós afetados e dados consultados; nunca recompor página inteira antes de fechar formulário.
7. Formulário sujo e modal aberto preservam foco e valores digitados; não substituir conteúdo na chegada tardia de requests.
8. Não fazer `POST` em `render*`, `setContent`, `table`, `pageTitle` ou `GET` de rede.
9. Não fazer `MutationObserver` para "consertar" DOM recomposto; corrigir a autoria do fluxo.
10. Sem renderização para ajustar rótulos após o fato: definir "Equipamento" diretamente nas telas originais.

**Estado da migração:** itens 1–4 e 10 são o primeiro corte desta branch. Os itens
5–7 em *todos os formulários* exigem fase incremental por tela, com QA de foco/edição/scroll.
Há `renderSales`, `renderWorkOrders`, `renderServices`, `openWorkOrder` e outros
recargas pós-escrita ainda identificados. Não declarar "zero rerender" até substituí-los e testá-los.

## 5. Conciliações pendentes antes de novos módulos

### C1: estoque
`inventory_movements` e `sale_stock_movements` hoje descrevem partes diferentes do consumo.
Projetar uma única operação de estoque com origem (`OS`, `BALCAO`, `AJUSTE`, `ESTORNO`),
`source_id` único e livro auditável. Não duplicar baixa quando uma OS gera venda.

### C2: orçamento/recebimento/caixa
OS tem orçamento e `receipts`; balcão tem `sales` e `cash_movements`.
O sistema ainda não declara que uma OS faturada **é** uma venda de balcão. Antes de unificar,
criar ligação canônica `work_order_id`/documento/recebimento e política por forma de
pagamento, com testes de não dupla contagem e estorno coerente.

### C3: fiscal
Documento fiscal será **snapshot** da venda ou OS; emissão e cancelamento não alteram
quantidades/recebimentos por conta própria. O Fiscal Core do ERP entra **depois**
de C1/C2, isolado e inicialmente só em simulação/homologação.

## 6. Gates de entrega

`npm run ci`; GitHub Actions CI; CircleCI quality, desktop, mobile; QA visual;
testes de transição, atomicidade, idempotência e não reconstrução do DOM;
sem alterar secrets, sem publicar e sem merge antes de autorização.

Este ADR não representa homologação fiscal, instalação Windows validada nem reconciliação
de estoque/caixa concluída.
