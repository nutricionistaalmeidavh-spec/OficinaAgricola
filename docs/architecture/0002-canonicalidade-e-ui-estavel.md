# ADR-0002 — Contrato canônico do ArtiSys Oficina
Status: **C1 aplicado em branch para validação — não publicado**.
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
| Estoque disponível | `inventory_movements` (livro canônico); `parts.quantity` é projeção | `src/services/inventory.js` (`postStockMovement`) | `sale_stock_movements` é legado, migrado sem nova baixa | Entradas, OS, balcão e estorno passam pelo mesmo escritor, com origem única |
| Venda de balcão | `sales`, `sale_items` | `src/services/sales.js` | `request_id`/hash protege reenvio; movimentos vinculados à venda | Venda, baixa e caixa atômicos; idempotência; estorno único |
| Caixa | `cash_sessions`, `cash_movements` | `payment-ledger.js` escreve movimentos; `sales.js` abre/fecha sessões | Saldo esperado por movimentos e forma de pagamento | Caixa histórico preservado, movimentos OS e balcão com referências exclusivas |
| Recebimento de OS | `receipts` e `payment_events` | `finance.js` valida o título; `payment-ledger.js` lança receita/estorno | `paymentSummary` deriva do saldo da OS; `financeSummary` soma eventos assinados | Chave de requisição única, estorno sem apagar histórico, sem dupla entrada no caixa |
| Despesa | `expenses` | `src/services/finance.js` | Somatórios são consultas derivadas | Sem lançamento automático adicional de caixa até existir vínculo canônico |
| Agenda / checklist | `schedule_events`, `work_order_checklists` | `src/services/operations.js` | Visões por OS e técnico | Checklist é registro finalizado, não autoriza alteração de OS por fora |
| Anexos | `attachments` e arquivos locais | `src/services/operations.js` | Modal e PDFs consultam os dados existentes | Guardar referência e validar integridade/arquivo |
| Usuários e sessões | `users`, `sessions` | `src/auth.js` e rotas administrativas | `state.user` é só representação da sessão | Senhas são hashes; papéis no servidor, nunca só na UI |

**C1:** livros transacionais de estoque e pagamentos usam um caminho canônico com migração aditiva. `sale_stock_movements` fica preservado apenas como histórico legado e não recebe novos lançamentos. `payment_events` é o único livro financeiro de receita/estorno; `cash_movements` é a projeção por sessão de caixa. Pagamentos de OS não são automaticamente uma `sale` de balcão; criar venda com `workOrderId` é recusado para não duplicar a cobrança.

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

**Estado da migração C1:** os callbacks pós-save usam `refreshCurrentPage()`; `setContent` e a atualização de modal aplicam reconciliação de nós alterados, preservando DOM, foco, valor digitado e scroll. Navegação para outra página ainda monta uma tela inicial, e fechamento intencional de modal remove seu conteúdo. QA de navegador valida preservação do nó da lista após salvar cliente.

## 5. Conciliação concluída no C1 e limitações

### Estoque canônico
`inventory_movements` é o livro unificado; `postStockMovement` escreve saldo e evento na mesma transação. Novas vendas/estornos não gravam `sale_stock_movements`. Migração idempotente importa o legado sem reaplicar saldo. `reconcileStock` permite conferir livro versus `parts.quantity`.

### Recebimentos, vendas e caixa
`payment_events` contém eventos `PAID`/`REFUNDED` com chave única por origem (`SALE` ou `OS_RECEIPT`). `cash_movements` guarda a projeção de movimentos da sessão aberta, com vínculo ao recibo/venda. Dinheiro em espécie exige caixa aberto. Pagamentos eletrônicos sem sessão ativa continuam auditados no livro financeiro sem criar caixa fictício. `financeSummary` soma eventos assinados e inclui vendas balcão concluídas; `getPaymentSummary` calcula o saldo das OS pelo recebimento líquido.

**Limite explícito:** uma OS aprovada e uma venda de balcão continuam documentos de negócio diferentes. Não se converte automaticamente orçamento da OS em venda de balcão; a API recusa `workOrderId` em venda para evitar dupla cobrança. Um documento fiscal/contábil unificado que vincule ambos, quando necessário, depende de modelo específico numa etapa posterior, sem duplicar estoque ou pagamentos.

### Fiscal
A emissão fiscal permanece desativada. Futuro adaptador do ERP consumirá snapshots das origens canônicas e jamais movimentará estoque/caixa por conta própria.

## 6. Gates de entrega

`npm run ci`; GitHub Actions CI e matriz QA visual desktop/mobile (Playwright); testes
de transição, atomicidade, idempotência, reconciliação, foco e DOM estável.
Sem CircleCI como executor configurado, sem secrets, sem publicar e sem merge antes de autorização.
**Integração externa CircleCI:** a remoção do YAML não desinstala um aplicativo/projeto CircleCI vinculado; desconectar externamente se ele continuar reportando status ao GitHub.

Não representa homologação fiscal nem instalador Windows validado.
