# Oficina — pagamentos P0–P2 (implementação incremental)

## Contrato e disponibilidade

**Núcleo obrigatório:** código open source, SQLite local ou PostgreSQL self-hosted, sem API externa e sem custo de licença. Pagamentos em dinheiro/transferência/Pix conferido manualmente continuam possíveis sem qualquer integração. A instituição financeira e a adquirente podem cobrar por suas operações; isso nunca é obrigatório para abrir o sistema.

A PR de pagamentos deve ser integrada **após** estabilizar a base multiempresa/PostgreSQL. Não habilitar o serviço nativo em produção enquanto os gates de migração/segurança falharem.

| Canal | Implementação | Disponibilidade |
| --- | --- | --- |
| Dinheiro, pagamentos parciais e mistos | `receipts`, `payment_events`, `cash_movements` canônicos preexistentes | Local R$ 0 |
| Pix estático | BR Code EMV/CRC16, valor e identificador da intenção | Configurável, conferência manual |
| Pix bancário dinâmico | Contrato `createBacenPixProvider` (PUT/GET `/cob/{txid}`) | **Inativo** sem API bancária OAuth2/mTLS |
| TEF e Smart POS | Contrato `createLoopbackPaymentProvider` | **Inativos** sem ponte instalada/configurada/homologada |
| Boleto, estorno Pix, devolução de cartão, webhook bancário | Fora do escopo entregue neste incremento | Não disponível |

### Fluxo financeiro

`OS aprovada → payment_intents.PREPARING → PENDING → consulta autenticada do banco/operadora → PAID → receipts/payment_events`.

- `payment_intents` guarda a intenção de cobrança, não é receita nem substitui o financeiro.
- `requestId` impede duplicação da intenção; o evento financeiro recebe chave idempotente derivada da intenção.
- Receber uma confirmação exige **referência, status e valor coerentes** consultados via adaptador configurado no backend. A API pública jamais aceita `status=PAID` do navegador.
- Pagamento manual só deve ser registrado por operador após comprovação independente, especialmente para Pix estático.
- Pagamento parcial/misto continua no saldo canônico da OS; a cobrança não pode exceder o saldo visível.
- Recebimentos vinculados à adquirente não devem ser estornados somente no caixa; reembolso efetivo precisa de confirmação do operador financeiro.

## Configuração opcional — instalação local

Quando a oficina usa `npm start` no computador local, o Pix estático pode ser ativado com **todas** estas variáveis de ambiente, definidas fora do repositório:

```dotenv
OFICINA_PIX_KEY=<chave-do-recebedor>
OFICINA_PIX_MERCHANT_NAME=<nome-do-estabelecimento>
OFICINA_PIX_CITY=<cidade>
```

Não colocar valores de produção no `.env.example`, código, log, GitHub ou arquivos de teste. Ausência de qualquer variável significa recurso não configurado e sistema operacional normal.

## Configuração opcional — multiempresa

Os gateways multiempresa podem receber `TENANCY_PAYMENT_CONFIG_FILE` apontando para um arquivo JSON **local, privado, fora do repositório**:

```json
{
  "1/1": {
    "pixStatic": {
      "pixKey": "chave-configurada-fora-do-git",
      "merchantName": "OFICINA MATRIZ",
      "merchantCity": "UBERABA"
    }
  }
}
```

Chave `empresa/unidade`: não há herança de recebedor entre filiais. Unidades sem configuração permanecem sem Pix estático. O backend rejeita chaves duplicadas entre unidades e não aceita secret de TEF no arquivo de chaves Pix. Controle de acesso ao arquivo é responsabilidade do operador local.

## Endpoints

O servidor local fornece `/api/payment-intents`; o gateway nativo PostgreSQL traduz as rotas para `/v1/payment-intents`. Exigem sessão autenticada e função `ADMIN` ou `FINANCEIRO`.

```http
GET  /api/payment-intents/capabilities
POST /api/payment-intents
GET  /api/payment-intents/:id
POST /api/payment-intents/:id/sync
```

Exemplo de payload de criação:

```json
{
  "workOrderId": 128,
  "amountCents": 2500,
  "method": "PIX_STATIC",
  "requestId": "cobranca-os128-01"
}
```

Resposta inclui `status: PENDING`, `pix_payload` para Pix e `id`. A interface da OS apresenta o Pix Copia e Cola e ação de consulta de confirmação somente quando o método possui adaptador externo.

**Não fazer baixa com `/sync` em Pix estático**: é uma modalidade sem confirmação automática. A baixa exige consulta no app/extrato bancário e registro manual separado na OS.

## Implementação de provedores

- **Banco / PSP Pix:** implementar `transport(method,path,body)` com mTLS, OAuth2, escopos, renovação de token, host fixo do PSP, limites de tempo e tratamento de falha. Integrar ao `createBacenPixProvider`. Nunca expor token/certificado ao navegador.
- **TEF / Smart POS:** instalar uma ponte local autenticada em `127.0.0.1` com endpoints `/v1/payment/create` e `/v1/payment/status`, referenciando transação imutável, valor, autorizador e comprovante conforme manual do fornecedor. Só aceitar `PAID` após comprovação do TEF/adquirente. O protocolo PayGo/SiTef real e a homologação não são implementados por este contrato genérico.
- **Rede/offline:** serviços financeiros externos exigem conectividade para confirmar; registrar pagamento como pendente em falha. Quando o backend roda em VPS, `127.0.0.1` significa o servidor, não a máquina do cliente — a ponte física precisa de arquitetura de agente local separada.

## Gates antes de merge / deploy

Executar `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`; PostgreSQL 16 e D1 em ambientes reais de teste; concorrência de recebimentos; RBAC por empresa/unidade; backup/restore; build Windows; QA visual e teste com PSP/TEF em **homologação**. Os três testes legados que exigem `package.json` sem nenhuma dependência falham atualmente porque a base da PR #32 já introduziu o driver open source `pg`. Isso não constitui aprovação de CI, e a resolução precisa manter a instalação local gratuita e funcional sem PostgreSQL.
