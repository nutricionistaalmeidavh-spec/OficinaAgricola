# Oficina — P3/P4: parcelamento e financeiro sem provedor obrigatório

## Arquitetura e custos
O núcleo de pagamentos do Oficina é **R$ 0, open source e self-hosted**, com
livro canônico `receipts`/`payment_events`. Nenhum banco, gateway, API externa
ou contrato comercial é obrigatório para operar o parcelamento e o financeiro.
SQLite local e PostgreSQL self-hosted usam o mesmo contrato; D1 é opcional.

Não existe integração comercial de boleto/link ativa nesta branch.
Os métodos `BOLETO` e `PAYMENT_LINK` permanecem apenas como extensão genérica
**desativada por padrão**. Nenhum provedor pago substituiu o removido.
A interface só exibe esses métodos quando o servidor expõe um adaptador habilitado
para a unidade. Não há dependência silenciosa ou cobrança automática.

## P3 — parcelamento e cobrança
- Um plano por OS aprovada, de 1 a 24 parcelas, com datas mensais e centavos exatos.
- Plano de cobrança não é receita: a baixa ocorre apenas em `receivePayment`.
- O total parcelado deve corresponder ao saldo aprovado e ainda pendente.
- `MANUAL`: colaborador autorizado confirma o recebimento **após conferência real**
  no banco/caixa; confirmação explícita e idempotência obrigatórias.
- `BOLETO` e `PAYMENT_LINK`: contrato `providers[method]` com
  `create({requestId,workOrderId,amountCents,dueDate})` e
  `status(reference,{requestId,workOrderId})`, sem implementação externa embutida.
- Cobranças externas exigem referência, valor e estado autenticados pelo provedor.
  Jamais aceitar um `PAID` fornecido pelo navegador.
- Emissão externa tem estado `READY` → `ISSUING` → `ISSUED`, com trava de
  concorrência e recuperação somente mediante consulta ao provedor. Falha
  ambígua nunca provoca repetição silenciosa do POST.
- Após confirmação externa, o lançamento financeiro usa chave idempotente,
  preservando saldo e histórico canônicos.

## P4 — financeiro self-hosted
- Importação **manual por lançamento** de extrato, com conta, ID externo,
  data, valor e descrição; reimportar com dados divergentes é proibido.
- Conciliação de extrato selecionando recebimento existente por OS e valor.
  Associar um lançamento **não cria uma segunda receita**.
- Taxas, repasses brutos/líquidos e data do repasse associados à parcela recebida,
  sem modificar a receita bruta no livro canônico.
- Relatórios de parcelas pagas, pendentes, vencidas, taxas, repasses e extratos
  conciliados. O relatório financeiro geral continua incluindo vendas e OS.
- Recibos/PDF existentes continuam gerados pelo módulo canônico de documentos.
- Lembretes apenas como registros `DRAFT` locais, sem envio automático,
  WhatsApp, SMS ou e-mail.
- Estorno de parcela manual reabre o título com uma nova tentativa auditável.
  Recebimentos de cobrança externa, extrato já conciliado ou repasse
  registrado bloqueiam estorno local sem o fluxo de reconciliação necessário.

## APIs autenticadas (FINANCEIRO/ADMIN)
```text
GET  /api/billing/capabilities
POST /api/billing/plans
GET  /api/billing/orders/:id/plan
GET  /api/billing/plans/:planId
POST /api/billing/installments/:installmentId/activate
POST /api/billing/installments/:installmentId/sync
POST /api/billing/installments/:installmentId/manual
POST /api/billing/settlements
GET  /api/billing/report
GET  /api/billing/statements
POST /api/billing/statements
GET  /api/billing/receipts/available
POST /api/billing/statements/:entryId/match
POST /api/billing/reminders/prepare
```

## Liberação
1. `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`.
2. PostgreSQL real e D1 local com migrations, isolamento entre unidades,
   conciliação e concorrência de recebimentos.
3. QA visual e Windows clean install; operação offline sem qualquer gateway,
   além de backup/restauração.
4. Qualquer adaptador externo futuro exige decisão explícita, homologação,
   configuração privada por oficina e testes de falha/estorno.
5. PR #37 depende da PR #36, que depende da PR #32.
   **Nenhum merge ou deploy automático antes de todos os gates verdes.**

### Limites atuais
Não há emissão operacional de boleto/link sem integração externa, nem importação
OFX/CSV em lote, nem envio automático de mensagens, nem estorno externo.
O parcelamento e a conciliação manuais permanecem disponíveis sem mensalidade.
