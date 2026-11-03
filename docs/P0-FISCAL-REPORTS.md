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