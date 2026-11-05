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
- Importação por lançamento individual **ou arquivo OFX/CSV**, com identificação da conta, data, valor e descrição. Arquivos até 1 MB/1.000 transações; OFX exige `FITID`, CSV aceita colunas `Data`, `Valor`, `Descrição` e ID opcional.
- Os IDs do arquivo são preservados. Quando CSV não tem ID bancário, IDs determinísticos por data/valor/descrição/ocorrência permitem reimportação do mesmo conteúdo; arquivos sobrepostos sem ID precisam de revisão humana para evitar colisões.
- Conciliação de extrato selecionando recebimento existente por OS e valor.
  Associar um lançamento **não cria uma segunda receita**.
- Taxas, repasses brutos/líquidos e data do repasse associados à parcela recebida,
  sem modificar a receita bruta no livro canônico.
- Relatórios de parcelas pagas, pendentes, vencidas, taxas, repasses e extratos
  conciliados. O relatório financeiro geral continua incluindo vendas e OS.
- Recibos/PDF existentes continuam gerados pelo módulo canônico de documentos.
- Lembretes com agendador local a cada 6 horas (prepara rascunhos sem rede); **envio automático por e-mail exclusivamente se a oficina habilitar SMTP próprio com TLS**. Registro único por lembrete e estado `SENT`/`UNKNOWN`, sem reenvio após timeout ambíguo.
- A oficina deve verificar a legitimidade dos destinatários e sua política de comunicações. Nenhum serviço de e-mail terceirizado é obrigatório.
- Estorno de parcela manual reabre o título com uma nova tentativa auditável.
- Para cobranças externas do P3, existe fluxo **opt-in** de solicitar e consultar estorno no provedor. A baixa financeira só ocorre após `refundStatus` confirmar referência, cobrança original e valor exato. Extrato ou repasse já conciliado impede solicitação. Em falha ambígua não há reenvio automático. **Nenhum adaptador de banco/adquirente vem habilitado**.

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
POST /api/billing/statements/import
GET  /api/billing/receipts/available
POST /api/billing/statements/:entryId/match
POST /api/billing/reminders/prepare
POST /api/billing/reminders/run
GET  /api/billing/reminders
POST /api/billing/installments/:installmentId/refund
GET  /api/billing/refunds/:refundId
POST /api/billing/refunds/:refundId/sync
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

## Configuração opcional — SMTP self-hosted

Sem configuração, o Oficina apenas cria os rascunhos automaticamente;
**nenhum e-mail sai do sistema**. Para envio real, o administrador pode
operar um servidor SMTP livre, por exemplo Postfix, com SMTPS/TLS e
certificado válido (porta 465 padrão).

Instalação local/legada, configurada fora do repositório:

```text
OFICINA_REMINDER_SMTP_ENABLED=true
OFICINA_REMINDER_SMTP_HOST=mail.exemplo.local
OFICINA_REMINDER_SMTP_PORT=465
OFICINA_REMINDER_SMTP_FROM=financeiro@exemplo.local
OFICINA_REMINDER_SMTP_USER=usuario-opcional
OFICINA_REMINDER_SMTP_PASSWORD=senha-privada-opcional
```

Multiempresa SQLite e PostgreSQL: arquivo privado opcional
`TENANCY_REMINDER_SMTP_CONFIG_FILE=/local/privado/smtp.json`, com
configurações separadas por empresa/unidade:

```json
{
  "1/1": {
    "host": "mail.exemplo.local",
    "port": 465,
    "from": "financeiro@exemplo.local"
  }
}
```

Credenciais SMTP, se necessárias, ficam exclusivamente nesse arquivo
privado, nunca no repositório. A unidade não herda configuração de outra.
A rotina local e a runtime PostgreSQL programam o preparo de lembretes.
No D1, a criação e o disparo por API exigem agendamento explícito no
ambiente operacional; o Worker não mantém timers permanentes.

## Contrato para estornos externos

Somente um adaptador explicitamente homologado por unidade pode habilitar
estornos. Além de `create` e `status` para cobranças, ele implementa:

```js
refund({requestId,chargeReference,amountCents})
  // => {reference:'referencia-do-estorno'}
refundStatus(refundReference,{requestId,chargeReference,workOrderId})
  // => {reference:refundReference,chargeReference,
  //      status:'PENDING'|'FAILED'|'REFUNDED',amountCents}
```

Não registrar estorno pelo simples retorno da solicitação. Uma resposta
ambígua deixa `ISSUING` e exige recuperação operacional, para não enviar
duas devoluções de dinheiro. Cobranças do fluxo Pix/TEF P2, sem contrato de
devolução homologado, **continuam bloqueadas** para estorno externo.

## Limites atuais

Não há emissor bancário de boletos/links pronto, reembolso via instituição
financeira sem adaptador homologado, integração nativa com WhatsApp/SMS,
nem reconciliação de arquivos sem ID transacional garantida entre bancos.
O núcleo continua totalmente funcional para parcelamento manual, importação
de OFX/CSV, geração local de avisos e conciliação sem mensalidade.

**Validação antes do merge:** CI, migração de bancos existentes (PostgreSQL
recebe migração incremental; D1 requer execução autorizada de `/v1/migrate`
na atualização), testes de segurança, QA visual no Windows, teste SMTP real
contra servidor self-hosted e homologação de estornos com instituição escolhida.
