# Oficina — P3 Cobranças e P4 Financeiro (dependências opcionais)

## Status
Implementação de desenvolvimento na PR #37, empilhada na PR #36 e PR #32. **Não fazer merge ou publicar antes de CI, QA visual e integração de provedor real.**

### P3 — parcelamento + cobrança
- Núcleo obrigatório **R$ 0 / open source / self-hosted** com plano por OS e parcelas (1–24), centavos exatos e vencimentos mensais.
- Sem duplicar receita: `billing_plans` e `billing_installments` são obrigações futuras; o saldo recebido só é alterado pelo serviço canônico `receivePayment`.
- Um plano por OS, por enquanto; o valor deve corresponder ao saldo integral pendente. Novos planos após alterações da OS, cancelamentos parciais ou renegociações ainda precisam de fluxo próprio.
- Modalidade `MANUAL`: operador FINANCEIRO/ADMIN confirma recebimento **depois** da conferência bancária/caixa. Modos `BOLETO` e `PAYMENT_LINK` só funcionam se um provedor for explicitamente habilitado.
- `PAYMENT_LINK` do Asaas nesta implementação é a URL `invoiceUrl` de **uma cobrança individual** em `POST /v3/payments` (`billingType=UNDEFINED`), não o recurso de link reutilizável `POST /v3/paymentLinks`.
- Nunca usar o status retornado pelo navegador para liquidar cobrança; `syncInstallment` valida ID, referência, cliente, forma e valor diretamente com o provedor. Para Asaas a baixa conservadora ocorre apenas em `RECEIVED`, não em `CONFIRMED`.
- Em erros de rede, o Asaas é consultado por `externalReference` antes de criar novamente; concorrência e falhas ambíguas de emissão ainda exigem testes de homologação. Não ativar produção sem revisar possíveis duplicidades.

### Configuração opcional Asaas, por empresa/unidade
Por padrão, nenhuma integração Asaas está habilitada. O core funciona sem conta e sem API. Crie um arquivo JSON **privado, fora do repositório**, por exemplo `/etc/oficina/asaas.json`, com permissões restritas:

```json
{
  "1/1": {
    "environment": "sandbox",
    "apiKey": "CHAVE_SANDBOX_PRIVADA_DA_UNIDADE",
    "customers": {
      "12": "cus_ID_DO_CLIENTE_JA_CADASTRADO_NO_ASAAS"
    }
  }
}
```

`1/1` significa empresa/unidade do registro canônico; `12` é o ID local do cliente da OS; `cus_...` é o ID preexistente do cliente **na mesma conta** Asaas. Esta versão não cria automaticamente clientes Asaas. Uma OS de cliente não mapeado não pode emitir cobrança externa.

No servidor:
```bash
TENANCY_ASAAS_CONFIG_FILE=/etc/oficina/asaas.json
npm start
# ou npm run start:multi
# ou npm run start:postgres:unified (configuração PG opt-in já preparada)
```

Somente `sandbox` é habilitado sem aprovação explícita. Em produção deve-se configurar `environment: "production"` **e** `productionApproved: true`, além de chave correspondente à produção, após homologação. Nenhum segredo vai para o navegador, os commits, o PDF ou os logs. Os valores e URLs de terceiros são tarifados pelo provedor, nunca requisitos silenciosos.

**Operação:** abra uma OS aprovada com saldo a receber → **Parcelar / Boleto / Link** → escolha quantidade e primeiro vencimento → salvar. Para boleto/link, clique em **Emitir cobrança** na parcela e entregue ao cliente o link HTTPS retornado pelo provedor. Clique em **Consultar** para confirmar; a mesma parcela não pode dar duas baixas no caixa.

### P4 — financeiro
- **Conciliação bancária manual auditável**: registre cada lançamento de extrato com identificador externo e valor em centavos; o mesmo lançamento não pode ser importado com dados divergentes; associe a um recebimento real selecionando a OS. Conciliação NÃO registra nova receita.
- **Taxas e repasses**: lançamentos por parcela paga em `billing_settlements` com bruto, taxa, líquido, dia do repasse e requestId idempotente. Não alteram o valor bruto recebido canônico.
- **Relatórios**: total recebido **pelos parcelamentos**, saldo pendente, vencido, taxa total, repasses conciliados e extratos pareados. O relatório geral do financeiro continua fonte de verdade para todo o negócio (incluindo vendas balcão e recebimentos avulsos).
- **Recibos/PDF**: continuam no módulo canônico de documentos da OS; não são substituídos por notas fiscais ou extratos.
- **Lembretes**: botão `Preparar lembretes` gera registros `DRAFT` idempotentes no banco; **não envia e-mails, SMS ou WhatsApp**. Disparo automático requer um transportador configurado, opt-in por oficina e observância das preferências de contato. Nenhum serviço pago é obrigatório.
- **Estornos de cobranças externas**: bloqueados internamente até existir devolução/estorno confirmado pelo provedor; chargeback, reversão bancária e reconcilição retrospectiva ainda exigem fluxo de exceção.

### APIs autenticadas
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

Todas exigem sessão e FINANCEIRO/ADMIN tanto no servidor local quanto nos proxies PG/D1, com isolamento já garantido pelo runtime de unidades.

### Gates para merge
1. `npm run lint` e `npm test` (inclusive testes P3/P4/Asaas/segurança).
2. `npm run build` e `npm run test:e2e`; testes HTTP/UI e QA visual com estados pendentes e liquidados.
3. PostgreSQL 16 real e D1 Workerd com schema e operações P3/P4, inclusive concorrência.
4. Windows clean install, teste de offline sem gateway, restauração, backup e recuperação após timeout na emissão Asaas.
5. Homologação real de provedor opcional, registros de reconciliação, estornos e chargebacks antes de ativar produção.
6. CI verde no SHA final; aprovação de PR #32 e #36 primeiro. **NÃO MERGEAR** automaticamente.

**Limitações:** envio de mensagens e importação OFX/CSV em lote ainda não disponíveis; o extrato é registrado por lançamento. Nenhum fornecedor externo é obrigatório para parcelamento e gestão financeira internos.
