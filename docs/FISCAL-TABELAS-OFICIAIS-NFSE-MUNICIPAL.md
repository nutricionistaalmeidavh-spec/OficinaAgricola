# Fiscal — catálogos oficiais, regimes especiais e NFS-e municipal

**Estado:** implementação técnica de branch. Não corresponde a homologação fiscal nem autorização para emitir em produção.

## Fontes oficiais (05/11/2026)

- Portal NF-e: https://www.nfe.fazenda.gov.br/portal/
- IBS/CBS CST e cClassTrib: Informe Técnico 2025.002 v1.71, divulgado 30/10/2026.
- NCM: Informe Técnico 2024.001 v2.40, divulgado 03/09/2026.
- CFOP: Informe Técnico 2023.002 v2.10, divulgado 04/09/2026.
- Modelo INI ACBr Reforma Tributária: https://acbr.sourceforge.io/ACBrLib/ModeloNFeINIReformaTributaria.html
- NFS-e Nacional, manuais e layouts: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual

## Catálogo integral já incluído no código e no instalador

Em 05/11/2026 foi gerado o snapshot **src/platform/fiscal-data/catalog.json** diretamente a partir dos endpoints públicos governamentais. Contém:

- **10.516 NCM** vigentes do JSON oficial do Siscomex (Resolução Gecex nº 926/2026);
- **619 CFOP** do XLSX nacional de 04/09/2026 (incluindo entradas 1/2/3 e saídas 5/6/7);
- **173 cClassTrib/CST** do XLSX da SVRS referente ao IT 2025.002 v1.71, de 30/10/2026.

O mesmo arquivo é copiado para **dist/src/platform/fiscal-data/catalog.json** e entra automaticamente no ASAR do Electron. O runtime encontra o catálogo por caminho relativo ao módulo, sem solicitar download, terminal, arquivos ou variáveis ao cliente final. Nenhum código de exemplo é usado em produção.

A manutenção da base é tarefa da **ArtiSys**, no build: `python3 scripts/sync-official-fiscal-catalog.py` baixa as três fontes oficiais, verifica estrutura, valida quantidades mínimas e grava o arquivo com versões, datas, hashes dos arquivos de origem e SHA-256 do catálogo. O workflow `fiscal-sync-official.yml` pode regenerá-lo na branch de trabalho, sem deploy ou merge automáticos.

O script alternativo `scripts/import-fiscal-catalog.mjs` continua disponível para importações manuais de CSVs normalizados, apenas na manutenção do desenvolvedor. Instalações avançadas self-hosted podem apontar um arquivo próprio via `OFICINA_FISCAL_CATALOG_PATH`, sem alterar a distribuição padrão. **Não é uma etapa de instalação do cliente.**

O build do instalador executa `node scripts/assert-fiscal-data-bundle.mjs --dist` e falha se o arquivo estiver ausente, incompleto, alterado ou vencido. A CI confirma a inclusão no diretório de distribuição. O catálogo deve ser renovado a cada atualização oficial ou antes de 60 dias; isso exige um **novo pacote/atualização do Oficina**, e não operação manual dos clientes.

**Limites:** o hash de origem e o digest verificam integridade dos dados baixados, não autenticação criptográfica do governo. A revisão legal e a homologação com NF-e/NFC-e/NFS-e reais continuam exigidas para distribuição fiscal.

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

## Compatibilização com a main (05/11/2026)

A PR #45 recebeu um commit de merge da `main` atual, com execução completa de lint,
testes Node/Python/ACBr, build, validação offline dos três catálogos e jornadas E2E.
A revisão de NF-e/NFC-e usa a API segura de perfis tributários já presente na
`main`, sem aceitar seções INI arbitrárias enviadas pelo navegador; os campos
opcionais de IBS/CBS foram integrados nesse fluxo tipado. O conteúdo do catálogo
fiscal e os dados de cada empresa permanecem isolados. A homologação real,
certificados de clientes e liberação para emissão em produção são processos distintos.
