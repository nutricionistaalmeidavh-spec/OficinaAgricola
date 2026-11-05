# Cadastro tributário assistido — Oficina (NF-e/NFC-e e serviços)

## Fluxo no aplicativo

1. Em **Fiscal > Configuração fiscal**, informe CNPJ, UF, município IBGE, regime, inscrições e ambiente. Configure certificado A1 ou A3 no próprio computador.
2. Um usuário **ADMIN** acessa **Perfis tributários** e cadastra perfis reutilizáveis de mercadorias: NCM, CFOP, origem, CST/CSOSN, CST PIS/COFINS, unidade, CEST ou código de benefício, quando aplicáveis. É possível editar um perfil, sem modificar documentos já revisados.
3. Para serviços, o mesmo formulário cadastra regra do município: código IBGE, item da lista da LC 116, código municipal, CNAE, alíquota ISS e retenção. **Esse cadastro não habilita automaticamente NFS-e em municípios sem provedor validado.** A rota/competência NFS-e continua seguindo o fluxo municipal existente.
4. Em uma OS aprovada ou venda concluída, crie rascunho de **NF-e/NFC-e**. Abra **Revisar tributos**, informe série/número/natureza, dados fiscais de endereço, selecione o perfil aprovado para cada item e, quando for obrigatório, base, percentual e valor de ICMS/PIS/COFINS.
5. Salve. O backend verifica CNPJ, ambiente, UF/município, total comercial e hash imutável do rascunho, monta as seções de INI da ACBrLib e grava uma revisão fiscal privada. Só então é possível tentar transmitir pelo emissor local já configurado.

## Limites deliberados

- **Não inferir classificação nem impostos** por descrição, NCM, produto, município ou regime. Um contador ou responsável fiscal deve fornecer os códigos e valores. Situações de CST/CSOSN que exigem cálculos ou grupos avançados não são liberadas pela interface simplificada.
- O perfil de serviço municipal é preparação cadastral; **não é um emissor nacional de NFS-e**. É necessário validar o provedor, regras da competência, retenções, campos obrigatórios e autorização real para cada município.
- A numeração e a série informadas no formulário precisam ser controladas pelo contribuinte. O formulário não afirma reservar números globalmente nem automatiza inutilização/contingência.
- Este fluxo não comprova sozinho conformidade com todas as exigências vigentes de NF-e/NFC-e, inclusive regras estaduais específicas e campos de reforma tributária. Homologação real junto aos autorizadores e revisão contábil são etapas separadas.
- A consulta de status da SEFAZ não equivale a uma nota autorizada. Somente comprovantes oficiais verificados podem marcar documento autorizado.

## Segurança e persistência

Os perfis ficam em `tributario/profiles.json` dentro do diretório fiscal privado de **cada empresa/unidade**, vinculados ao CNPJ. A revisão de cada nota fica na pasta privada `entrada`, sob o nome `NFE-<id>-<hash>.review.json` (ou `NFCE-`), e é validada contra o snapshot original. O INI e o manifesto são gerados localmente pelo backend e não podem ser alterados pelo formulário depois de preparados. Senhas, PFX, PIN e chaves privadas de certificados **não** são copiados para esses perfis/revisões.

O operador self-hosted deve fazer backup do PostgreSQL **e** das pastas privadas fiscais; restaurar apenas o banco não recupera as revisões, XMLs ou configurações externas. Nenhum serviço pago é dependência obrigatória.
