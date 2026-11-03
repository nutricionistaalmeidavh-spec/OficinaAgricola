# P0 — Relatórios canônicos e preparação fiscal

**Estado em 03/11/2026:** núcleo e interface fiscal de preparação implementados em branch; emissão real NF-e/NFS-e **não homologada** e desabilitada sem emissor externo local configurado. Não vender ou divulgar a oficina como emissor autorizado até concluir as validações reais.

## O que existe

- Relatórios pelo SQLite sem corte de 200 OS; entrega no período por `delivered_at`; estoque crítico total, sem limite de 8.
- Dashboard recebe contagens e amostras de cada coluna diretamente do banco. A tela de OS usa paginação keyset (`/api/work-orders/page`) com cursor e botão para carregar mais, mantendo histórico de entregas.
- `fiscal_documents`: snapshot comercial imutável por origem/tipo, valor líquido alocado em centavos, chave única de origem e identificador de requisição; campos de ambiente, número, série, XML e protocolo.
- `fiscal_events`: trilha append-only de criação, início de envio, autorização, rejeição ou situação incerta.
- `fiscal_settings`: cadastro tributário mínimo validado e separado de segredos; fiscal desativado por padrão; produção requer confirmação administrativa explícita.
- NF-e para itens de peça e NFS-e para mão de obra, **somente rascunho** até integração homologada. Item 'TERCEIRO' ou 'OUTRO' bloqueia a divisão automática.
- Tentativa fiscal nunca grava novamente `inventory_movements`, `payment_events` ou `cash_movements`.
- Resposta de rede perdida deixa `INDETERMINADO`, exige consulta, e nunca provoca reenvio cego.
- Perfil `ADMIN` gerencia configuração; `ADMIN` e `FINANCEIRO` consultam e preparam documentos. API protege XML armazenado.

## Contrato opcional do emissor local

1. Na instalação comercial, configurar explicitamente `FISCAL_LOCAL_PROVIDER_URL=http://127.0.0.1:PORTA` **somente quando houver um adaptador fiscal self-hosted real e homologado**.
2. A URL aceita somente HTTP loopback sem credenciais em query/userinfo; não são permitidos redirecionamentos para serviços externos.
3. O sidecar deve implementar os endpoints `POST /v1/fiscal/transmit` e `POST /v1/fiscal/consult` em loopback.
4. Transmit recebe `documentId`, `kind` (NFE ou NFSE), `requestId`, `attemptId`, `issuer` (cadastro da empresa sem certificado), `snapshot` imutável da operação e `snapshotHash`.
5. Consult recebe `documentId`, `kind`, `requestId`, `attemptId`, `accessKey` (se conhecido). Deve consultar a autoridade antes de confirmar ausência ou rejeição, nunca inferir que timeout significa falha definitiva.
6. Somente uma autorização verificada pela autoridade fiscal poderá ser respondida como `AUTORIZADA`, com `environment` coerente (HOMOLOGACAO ou PRODUCAO), `accessKey`, `protocol`, `number`, `series` e `xml` assinado/autorizado.
7. Resposta `REJEITADA` traz `code` e `message`; respostas inconclusivas permanecem `INDETERMINADO`. O sistema distingue `AUTORIZADA_HOMOLOGACAO` de `AUTORIZADA` (produção).

**Este repositório não inclui um sidecar homologado, certificado A1/A3, XML assinado, cálculo tributário por item, motor de DANFE/DANFSe, credenciamento nem transmissão comprovada à SEFAZ/prefeitura.** Um adaptador que apenas devolva sucesso não é evidência legal de emissão. O mock usado nos testes só valida o contrato em ambiente controlado.

## ACBrLib nativa — integração self-hosted (opcional)

O repositório contém `src/platform/acbrlib-fiscal-provider.js` e `src/platform/acbrlib-worker.py`.
Com a configuração explícita, o Python 3 usa `ctypes` (biblioteca padrão) para invocar as
funções ACBrLib NFe/NFSe. A solução não usa ACBr API hospedada nem qualquer serviço pago.
Os fontes oficiais ACBr são LGPL e podem ser compilados localmente via Lazarus/FPC:
https://www.projetoacbr.com.br/fontes/.
Os binários Pro prontos e suporte comercial são opcionais, não pré-requisito do core.

**Python 3 e ACBrLib são necessários apenas ao módulo fiscal quando habilitado.**
Não baixar/empacotar binários Pro nem certificados no instalador; manter arquivos
de certificado/senhas no `ACBrLib.ini` do operador, fora do GitHub e do SQLite.

Configuração (somente caminhos absolutos, sem segredos):

- `FISCAL_ACBR_NFE_LIB`: biblioteca NFe compilada (.dll/.so)
- `FISCAL_ACBR_NFE_CONFIG`: ACBrLibNFe.ini local e privado
- `FISCAL_ACBR_NFSE_LIB`: biblioteca NFSe compilada (.dll/.so)
- `FISCAL_ACBR_NFSE_CONFIG`: ACBrLibNFSe.ini local e privado
- `FISCAL_ACBR_INPUT_DIR`: diretório privado dos INIs fiscais por documento
- `FISCAL_ACBR_PYTHON`: executável Python 3 (opcional se instalado no PATH)

Não configurar simultaneamente `FISCAL_LOCAL_PROVIDER_URL` e `FISCAL_ACBR_*`:
o sistema bloqueia o início com dois motores fiscais configurados.

### Entrada tributária exigida por documento

O orçamento contém valores e tipos de item, mas **não possui classificação
tributária suficiente para gerar NF-e/NFS-e legal automaticamente**.
NCM, CFOP, CST/CSOSN, ISS, classificação de serviço, número/série, IBS/CBS e
retenções dependem da operação, da legislação e do contador da empresa.

Até existir gerador tributário validado, prepare um INI completo de NFe ou NFSe
no layout ACBr. A pasta de entrada deve conter o par:

- `NFE-<id>-<snapshot_hash>.ini` (ou `NFSE-...`), com impostos revisados;
- `NFE-<id>-<snapshot_hash>.json` (ou `NFSE-...`), o manifesto:

```json
{
  "kind": "NFE",
  "documentId": 123,
  "snapshotHash": "<hash SHA256 do documento fiscal>",
  "amountCents": 10000,
  "issuerCnpj": "<CNPJ do emissor>",
  "environment": "HOMOLOGACAO"
}
```

**Valores acima são somente um modelo**: nunca emitir com hashes/tributos inventados.
Use os dados reais retornados pelo registro fiscal da Oficina.
O adaptador verifica o manifesto e os arquivos *antes* de marcar o início do envio.

### Passos técnicos invocados

- NF-e: NFE_Inicializar, NFE_LimparLista, NFE_CarregarINI, NFE_Assinar,
  NFE_Validar, NFE_ObterXml e NFE_Enviar.
- NFS-e: NFSE_Inicializar, NFSE_LimparLista, NFSE_CarregarINI e NFSE_Emitir.
- Retomada: NFE_Consultar (chave preservada do XML assinado) ou
  NFSE_ConsultarNFSePorRps (identificação do RPS original).
- Somente retorno inequívoco com XML processado e protocolo é aceito
  como autorizado; respostas de lote, timeout ou XML incompleto ficam INDETERMINADO.

**Estado de homologação:** contrato Node ↔ Python ↔ ACBr implementado e testado
sem acesso a DLL real e sem certificado. Não foram testadas autorizações
na SEFAZ ou no município. Não apresentar esta implementação como
emissão fiscal real já homologada. NFS-e varia por município e provedor.

Documentação ACBr:
https://acbr.sourceforge.io/ACBrLib/ComoemitirumaNFeouNFCe.html
https://acbr.sourceforge.io/ACBrLib/ComoemitirumaNFSe.html
https://acbr.sourceforge.io/ACBrLib/PreenchimentodoArquivoINI1.html
## Pré-requisitos para homologação real

- Validar com contador a natureza de serviço/mercadoria, regime, NCM, CFOP, códigos de tributação nacional/municipal e regras da UF/município; tratar terceiros separadamente.
- Conferir credenciamento, ambiente, certificado digital e integração real aos autorizadores.
- Validar schemas e versões oficiais de NF-e e NFS-e Nacional (DPS), assinaturas XML, protocolos, cancelamento, contingência e consulta em caso de timeout.
- Executar cenários de rejeição, autorização, duplicidade, queda após confirmação, consulta por chave, persistência de XML e faturamento sem dupla baixa de estoque/caixa.
- Homologar em ambiente fiscal de testes e depois realizar piloto autorizado de produção. Arquivos de homologação não têm valor fiscal.
- Garantir guarda e backup dos XMLs autorizados; testar restauração e auditoria.

Documentação oficial: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual e https://www.nfe.fazenda.gov.br/Portal/.

## Gates e distribuição

Executar `npm run ci`, QA Playwright desktop/mobile, build e smoke NSIS Windows. Não fazer merge nem publicar sem autorização do responsável e gates verdes. Serviço pago jamais é obrigatório para operação da oficina: fiscal pode ficar desabilitado, sem travar OS, estoque, venda ou caixa.

Limitação de produto: NFC-e, DANFE/DANFSe fiscal, cancelamento via autoridade e geração local de XML fiscal real ainda são entregas futuras. O recibo comum e PDF operacional não substituem nota fiscal.