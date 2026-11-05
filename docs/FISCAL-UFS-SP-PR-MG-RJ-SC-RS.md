# Integração fiscal inicial: SP / PR / MG / RJ / SC / RS

## Escopo e arquitetura

- ACBrLibNFe **self-hosted** para NF-e (55) e NFC-e (65), ACBrLibNFSe self-hosted para NFS-e conforme município. Sem API fiscal paga obrigatória e sem fallback remoto.
- Estados inicialmente atendidos no contrato fiscal: SP (35), PR (41), MG (31), RJ (33), SC (42), RS (43). UF e prefixo IBGE do município devem corresponder. UF do emitente e ambiente da biblioteca são configurados por instância; certificado e CSC permanecem no arquivo ACBr privado, nunca no banco, UI ou logs.
- NF-e e NFC-e são modalidades mutuamente exclusivas para os mesmos itens da OS/venda. NFS-e é para serviços, com regras municipais que **não** se resolvem apenas selecionando UF.
- Cadastro da empresa desbloqueia preparação/homologação; emissão real depende de classificação tributária revisada (NCM/CFOP/ICMS/PIS/COFINS/IBS/CBS quando aplicáveis), numeração e série corretas, credenciamento e certificado válido. Rascunhos e testes de homologação não têm validade fiscal.
- NFC-e: modelo 65, operações internas destinadas a consumidor final, pagamento no grupo `[pag001]`; card eletrônico integrado no grupo `[card001]`. Sem contingência offline automática, porque depende das regras de UF e da implementação específica. O motor não presume o enquadramento tributário nem grava secrets.
- Validação de integridade: snapshot imutável da operação, manifesto fiscal, XML assinado, protocolo/autorização, cancelamento, consulta após timeout (sem reenvio automático), PDF do documento autorizado.

## Particularidades estaduais

| UF | Cadastro/fluxo | Exigências para homologação real |
|---|---|---|
| SP | NFC-e modelo 65 após transição do SAT | CSC, credenciamento e ensaio com contribuinte emissor |
| PR | SEFA/Receita estadual, autorizador próprio | credenciamento, CSC e teste de emissão/retorno |
| MG | SIARE/SEF | credenciamento, CSC e exigências do software transmissor |
| RJ | Portal DF-e; NFC-e via SVRS | habilitação, CSC, validação do autorizador |
| SC | PAF-NFC-e | **empresa desenvolvedora previamente credenciada**, autorização de uso para contribuinte, especificação técnica do Ato DIAT 54/2026; pode haver taxa governamental e necessidade de laudo conforme cronograma |
| RS | NFC-e + meios eletrônicos de pagamento | CSC e integração efetiva do pagamento eletrônico/TEF-Pix conforme operação, incluindo identificadores autorizativos no XML quando exigidos |

Links oficiais para validação contínua (não fixar URLs SEFAZ em código; ACBr deve prover roteamento):
- SP: https://portal.fazenda.sp.gov.br/servicos/nfce
- PR: https://sped.fazenda.pr.gov.br/NFCe/Pagina/Credenciamento-de-emissores
- MG: https://portalsped.fazenda.mg.gov.br/spedmg/nfce/
- RJ: https://portal.fazenda.rj.gov.br/dfe/
- SC: https://legislacao.sef.sc.gov.br/html/atos_diat/2026/atodiat_26_054.htm e https://www.sef.sc.gov.br/servicos/solicitar-credenciamento-como-desenvolvedor-do-paf-nfce
- RS: https://receita.fazenda.rs.gov.br/
- ACBr: https://acbr.sourceforge.io/ACBrLib/ComoemitirumaNFeouNFCe.html

## Gates obrigatórios antes de distribuir como emissor homologado

1. Testes e build da branch integralmente verdes, incluindo Windows limpo e configuração do ACBr sem intervenção de terminal.
2. NF-e (55) em homologação com XML assinado/autorizado; NFC-e (65) em homologação com CSC e impressão de DANFC-e com QR Code, chave e protocolo, por **cada UF**; testar rejeição e reconciliação.
3. Conferir CSC/IdCSC por empresa e por ambiente, cUF/cMunFG, série/nNF, certificados A1/A3; validar normas fiscais vigentes, inclusive Reforma Tributária (IBS/CBS) quando aplicável. Não transmitir com configuração incompatível.
4. NFS-e validada **por município/provedor** antes de habilitar emissão efetiva de serviço; sem prometer cobertura nacional apenas por UF.
5. SP/PR/MG/RJ: efetuar credenciamento estadual e testes da integração; SC: credenciamento/homologação do PAF-NFC-e, autorização do desenvolvedor e contribuinte; RS: rastrear pagamento TEF/Pix real e NFC-e correspondente.
6. Testar cancelamento, XML/PDF, contingência devidamente implementada ou desabilitada, backups, duplicidade, mudança de ambiente e serialização PostgreSQL/D1.

**Estado:** contrato regional e base técnica implementados na branch. Este documento **não é certificado de homologação ou autorização de produção**. Não distribuir como emissor fiscal pronto até os testes oficiais específicos e obrigações externas estarem comprovados.
