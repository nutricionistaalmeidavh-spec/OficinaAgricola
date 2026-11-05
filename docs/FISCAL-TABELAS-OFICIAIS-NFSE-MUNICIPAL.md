# Fiscal — catálogos oficiais, regimes especiais e NFS-e municipal

**Estado:** implementação técnica de branch. Não corresponde a homologação fiscal nem autorização para emitir em produção.

## Fontes oficiais (05/11/2026)

- Portal NF-e: https://www.nfe.fazenda.gov.br/portal/
- IBS/CBS CST e cClassTrib: Informe Técnico 2025.002 v1.71, divulgado 30/10/2026.
- NCM: Informe Técnico 2024.001 v2.40, divulgado 03/09/2026.
- CFOP: Informe Técnico 2023.002 v2.10, divulgado 04/09/2026.
- Modelo INI ACBr Reforma Tributária: https://acbr.sourceforge.io/ACBrLib/ModeloNFeINIReformaTributaria.html
- NFS-e Nacional, manuais e layouts: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual

## Importação offline na máquina de build

O script scripts/import-fiscal-catalog.mjs recebe três CSVs normalizados a partir dos anexos oficiais:

- ncm.csv: cabeçalho NCM, seguido de todos os NCM ativos com oito dígitos.
- cfop.csv: cabeçalho CFOP, seguido dos CFOP de saída ativos (5, 6 e 7).
- ibscbs.csv: cabeçalho CST,cClassTrib,regime,reduction,deferral e as linhas revisadas. Regimes: REGULAR/REDUCAO/DIFERIMENTO/ESPECIAL, flags true/false. Não classificar tratamento não comprovado como REGULAR.
- source.json: chaves ncm, cfop, ibscbs, cada uma com url (HTTPS oficial), version e publishedAt (YYYY-MM-DD).

Comando (na raiz do repositório, sem acesso à rede):

    node scripts/import-fiscal-catalog.mjs --ncm ncm.csv --cfop cfop.csv --ibscbs ibscbs.csv --sources source.json --checked-at 2026-11-05 --out fiscal-catalog-20261105.json

Para ativar a checagem local configurar somente no ambiente privado do serviço:

    OFICINA_FISCAL_CATALOG_PATH=/pasta-privada/fiscal-catalog-20261105.json

O importador faz integridade SHA-256, datas, limites, duplicidades e URL oficial. O hash protege contra alteração local acidental, mas NÃO é prova criptográfica de autenticidade governamental; conferir a origem durante o preparo. Atualizar pelo menos a cada 60 dias. Emissão NF-e/NFC-e em produção falha fechada sem catálogo.

A distribuição não incorpora catálogos de exemplos usados nos testes. Para entregar o recurso funcionando, a ArtiSys precisa obter/revisar todas as linhas vigentes das tabelas oficiais e incorporar o artefato aprovado ao pacote, sem exigir que o cliente execute terminal.

## Tratamentos tributários

- NCM/CFOP/CST/CSOSN exigem revisão do enquadramento; o sistema não escolhe códigos por inferência.
- No IBS/CBS, o par exato CST + cClassTrib deve estar no catálogo. CST regular valida bases e valores. Redução e diferimento têm regras condicionais e conferência de alíquota efetiva, valores diferidos e devido por item.
- Grupos de totais IBS/CBS são calculados a partir dos itens e não podem ser sobrescritos por valores soltos.
- Monofásico, crédito presumido, combinação de redução e diferimento, compra governamental e casos sem regra implementada permanecem explicitamente bloqueados até prova de conformidade com o layout, base legal e testes oficiais.
- O INI ACBr permanece vinculado ao snapshot canônico e não duplica lançamentos no livro financeiro/estoque.

## NFS-e municipal

O ACBrNFSe da aplicação transmite/consulta RPS, mas não existe um único serviço NFS-e municipal válido automaticamente para todo o Brasil. A prefeitura pode usar emissor nacional ou próprio; regimes de ISS e regras de cancelamento variam.

A UI agora permite revisão de RPS, tomador, prestador, código da lista de serviços, tributação municipal, competência, base, alíquota, valor de ISS e retenção. Geração do INI é local, vinculada ao hash do documento. A emissão real continua dependente de credenciamento, certificado, parâmetros e homologação municipal.

Produção exige arquivo privado OFICINA_NFSE_MUNICIPAL_PROFILE_PATH, em JSON com schemaVersion=1 e municipalities indexados pelo código IBGE. Cada registro contém issuerCnpj, provider=ACBR_NFSE, serviceCodes revisados, reviewedAt (YYYY-MM-DD), homologationEvidence (referência de ensaio real) e authorizedBy (responsável fiscal). Evidência é declarada pelo operador e não é autenticada automaticamente no município. Não cadastrar referências fictícias. Sem essas informações, a produção NFS-e é bloqueada.

## Gates de liberação

1. CI, E2E, build e instalador Windows limpo no mesmo commit.
2. Catálogo completo e versão vigente, com conferência e evidência interna de proveniência.
3. Homologação NF-e/NFC-e com certificado e contribuinte habilitados por UF; autorização, rejeição, consulta, cancelamento e impressão.
4. Homologação NFS-e por município efetivamente habilitado, inclusive cancelamento e PDF.
5. Nenhuma publicação como emissor homologado somente com mocks ou status ONLINE da SEFAZ.
6. PAF-NFC-e de SC fora do escopo atual: não declarar suporte até cumprir credenciamento da desenvolvedora e regras específicas.

Core aberto, local e self-hosted, R$ 0; sem API fiscal paga obrigatória.
