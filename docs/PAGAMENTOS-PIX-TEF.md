# Oficina — Pagamentos P0/P1/P2 (branch isolada)

## Escopo e estado
- Core R$ 0, open source, SQLite local/offline ou PostgreSQL self-hosted; D1 apenas se configurado explicitamente.
- Livro canônico existente: `receipts` e `payment_events`. Nova tabela `payment_intents` **não é receita**; armazena apenas a intenção de cobrar.
- P0: criação/idempotência por empresa/unidade, vínculo com OS, valores inteiros em centavos, controle de saldo e conciliação pelo provedor.
- P1: Pix estático EMV/BR Code (copia e cola); sem chamada externa, **nunca baixa automaticamente**. Pix API: contrato para adaptador a banco homologado, desativado na ausência de adaptador.
- P2: contrato de adaptador TEF / SMART_POS, **desativado na ausência de provedor configurado/homologado**. Não há integração operacional PayGo/SiTef sem contrato de fabricante/adquirente.
- Não emite boleto, inicia cartão real nem realiza estorno real de provedor. Funcionalidades sujeitas a terceiros permanecem explicitamente opcionais.
- Nunca armazenar dados de cartão, PIN, tokens ou secrets em `payment_intents`.
- Status de autorização externo não é aceito do browser; apenas consulta de servidor a provedor autenticado confirma `PAID`.

## Pix local (instalação única/legado)
Configure no ambiente do servidor, somente se desejar Pix estático:

```bash
OFICINA_PIX_KEY=chave-do-estabelecimento
OFICINA_PIX_MERCHANT_NAME="NOME DA OFICINA"
OFICINA_PIX_CITY="UBERABA"
npm start
```

Use o botão **Cobrar via Pix/maquininha** na OS, escolha Pix Copia e Cola e copie o código.
Pix estático não reconhece pagamentos sozinho: após **conferir a entrada no banco**, use **Registrar pagamento manual** na mesma OS.

## Pix por unidade (modo multiempresa SQLite ou PostgreSQL)

Crie um JSON privado fora do repositório, por exemplo `/etc/oficina/payments.json`:

```json
{
  "1/1": {
    "pixStatic": {
      "pixKey": "email-da-unidade@example.com",
      "merchantName": "OFICINA MATRIZ",
      "merchantCity": "UBERABA"
    }
  },
  "1/2": {
    "pixStatic": {
      "pixKey": "outra-chave-da-filial@example.com",
      "merchantName": "OFICINA FILIAL",
      "merchantCity": "FRANCA"
    }
  }
}
```

O índice `empresa/unidade` deriva **exclusivamente** do registro autenticado de tenants. Configure:
```bash
TENANCY_PAYMENT_CONFIG_FILE=/etc/oficina/payments.json
npm run start:multi
# Ou, para o gateway PostgreSQL explicitamente habilitado:
# npm run start:postgres:unified
```

Não existe chave Pix global herdada por filiais. A configuração ausente mantém o serviço desativado. O sistema não persiste segredos bancários no banco; proteja o arquivo com permissões do sistema.

## Contrato dos adaptadores de adquirente e Pix API
Ao habilitar uma integração real, injetar no servidor o objeto `paymentOptions.providers`, mapeado por `PIX_API`, `TEF` ou `SMART_POS`, por unidade:

```js
{
 async create({requestId,amountCents,workOrderId}) {
   // Exigir idempotência do provedor. Retornar referência verdadeira.
   return {reference:'id-do-provedor',pixPayload:'codigo-pix-opcional'};
 },
 async status(reference,{requestId}) {
   // Consultar o provedor autenticado; nunca confiar em callback do navegador.
   return {reference,status:'PENDING',amountCents:10000};
 }
}
```

A implementação concreta (SDK, token, certificado, homologação, pareamento da maquininha) **não está presente** e necessita contratos e testes com o provedor. Não ligar ambiente de produção com implementações fake de teste. TEF/SitEF/PayGo exigem homologação e comunicação real com pinpad/serviço.

O método `syncIntent` consulta o provedor e verifica referência e valor exatos; depois chama **o mesmo serviço** `receivePayment` já usado por caixa e OS com `requestId=intent:<id>`. Sem autorização externa válida não gera `receipt` ou evento financeiro. Um status `PAID` confirmado não equivale a operação de estorno concluída; estorno contábil de cobranças externas está bloqueado até implementação de estorno validado externamente.

## APIs
- `GET /api/payment-intents/capabilities`: capacidades ativas da unidade.
- `POST /api/payment-intents`: `{workOrderId,amountCents,method,requestId}`, retorna `PENDING`/QR.
- `GET /api/payment-intents/:id`: leitura autorizada por FINANCEIRO/ADMIN.
- `POST /api/payment-intents/:id/sync`: consulta autenticada ao provedor, sem status fornecido pelo cliente.
- Os equivalentes nativos `/v1/payment-intents` exigem token de serviço interno e sessão pessoal com RBAC.

## Critérios de qualidade antes de qualquer merge/deploy
- `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`.
- Testes do contrato: CRC Pix, chave por unidade, bloqueio de fallback, idempotência, recebimento parcial, diferença de valor, confirmação apenas pelo provedor, estorno externo protegido.
- Gates de PostgreSQL/D1 reais, QA de UI e instalador Windows, especialmente porque esta branch parte da PR #32 ainda em revisão.
- Sem merge automático e sem mudança de chaves existentes.
