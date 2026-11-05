# Gate fiscal por empresa/unidade — evidência real de homologação

## Contrato

A fonte de verdade é o banco canônico da unidade. O estado exibido em `GET /api/fiscal/onboarding` é calculado no mesmo backend que autoriza ou recusa `POST /api/fiscal/:id/submit`. A interface não gera permissão por checkbox, cache, localStorage ou resposta de ping.

### Como uma prova é produzida

1. O responsável cadastra CNPJ, UF, município IBGE, regime e certificado A1/A3 da unidade.
2. Na **homologação**, o documento NF-e (55) ou NFC-e (65) precisa ter revisão tributária associada ao seu snapshot, configuração do emissor ACBr local, resposta de autorização e XML processado com chave, protocolo, ambiente e CNPJ compatíveis. Emissor simulado e mera consulta de status não produzem prova.
3. O backend registra, junto ao evento fiscal autorizado, uma linha append-only em `fiscal_homologation_evidence`, vinculada ao documento, ao digest do cadastro emissor e à identidade opaca do certificado selecionado. PFX, senha e PIN **não** são persistidos nessa tabela.
4. O estado por modelo é derivado novamente a cada leitura do cadastro, exigindo documento ainda autorizado, XML íntegro, emitente, certificado e modelo equivalentes.
5. Em **produção**, o backend exige prova daquele **mesmo modelo** e configuração administrativa de produção. Quando falta prova, retorna conflito HTTP e preserva o rascunho sem iniciar transmissão.

Trocar CNPJ, UF, município, regime, inscrições ou certificado invalida a prova antiga para a configuração atual sem apagar o histórico. Cada banco pertence a uma unidade e não transfere provas entre empresas.

## Limites que não devem ser interpretados como homologação

- NF-e e NFC-e exigem provas **separadas**: uma NF-e autorizada não libera NFC-e.
- NFS-e municipal/nacional requer fluxo e validação próprios; não é liberada com prova de NF-e.
- Para NFC-e em SC, PAF-NFC-e e credenciamento específico ainda precisam de implementação/validação regulatória. Para RS, a vinculação efetiva aos pagamentos eletrônicos ainda precisa de prova.
- O status `productionReady` significa que as pré-condições técnicas codificadas para **aquele modelo** estão atendidas e que uma tentativa é permitida. Não representa credenciamento genérico do contribuinte, laudo, autorização do desenvolvedor, garantia de aprovação da nota, dispensa de consultoria tributária ou emissão já autorizada.
- A configuração tributária válida de **cada documento** ainda passa pela preparação e validação do INI; homologar um conjunto de itens não aprova automaticamente NCM, CFOP, CST ou CSOSN de itens distintos.
- O diagnóstico `Testar SEFAZ` verifica comunicação e certificado, mas não produz sozinho a prova de homologação.
- O checklist P7 refere-se aos gates de entrega/CI da **ArtiSys**, não a uma ação que a empresa cliente deva preencher.

## QA mínimo para entrega

Verificar reversibilidade e isolamento dos dados; testes D1/PostgreSQL; certificado trocado; XML inválido; tentativa sem homologação; NF-e e NFC-e separadas; alteração de emitente/regime; cancelamento da prova; instalação Windows limpa; homologação **real** com CNPJ e certificado habilitados por UF antes de anunciar o emissor como comercialmente homologado.

**Core:** R$ 0, self-hosted, open source, ACBrLib local. Nenhuma API fiscal paga é dependência implícita.
