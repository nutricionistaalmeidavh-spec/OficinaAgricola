# Preparação regional fiscal: municípios DDD 44 no Paraná

## Escopo e dados
- **124 municípios**, relacionados em `public/pr-ddd44-municipios.js`, com nome e código oficial IBGE (sete dígitos).
- DDD é somente um filtro de conveniência para o cadastro; a chave fiscal da empresa continua sendo **UF = PR + município IBGE**.
- O seletor opcional de municípios DDD 44 autopreenche o campo IBGE da configuração fiscal, sem restringir contribuintes dos outros municípios do Paraná.
- Catálogo empacotado localmente com o instalador, **R$ 0, offline, open source, sem API de terceiros**.
- **Sabáudia não entra no catálogo:** usa o DDD 43 desde 2013; listas mais antigas incluem-na por engano.

## Municípios-polo para homologação prioritária
| Município | IBGE |
| --- | --- |
| Maringá | 4115200 |
| Umuarama | 4128104 |
| Paranavaí | 4118402 |
| Campo Mourão | 4104303 |
| Cianorte | 4105508 |
| Sarandi | 4126256 |
| Goioerê | 4108601 |
| Guaíra | 4108809 |
| Assis Chateaubriand | 4102000 |
| Paiçandu | 4117503 |

## Requisitos de emissão por tipo
1. **NF-e (55) e NFC-e (65):** continuam sob a SEFA/PR. A cidade define o cMunFG/código IBGE no documento; não criar motor estadual ou CSC diferente por município. Validar credenciamento, certificado e CSC do estabelecimento, modelos fiscais, classificação tributária e XML autorizado, QR-Code/DANFC-e e cancelamento em homologação. **Não liberar automaticamente para produção.**
2. **NFS-e:** verificar por município os canais efetivos de emissão, adesão ao padrão nacional, legislação de ISS, exigência de inscrição municipal, códigos de serviço, credenciais e endpoints em homologação/produção. A adesão do município ao ambiente nacional **não prova** que a integração do emissor esteja funcional nem que todos os contribuintes utilizem a mesma API.
3. **Sem inferência pelo telefone:** DDD do contato não determina competência tributária, endereço do estabelecimento nem município fiscal do tomador/prestador.
4. **Outros municípios do PR:** continuam permitidos pelo campo IBGE manual, conforme validação estadual já existente.

## Regra nacional de 01/11/2026 — NFS-e de ME/EPP do Simples
- Para **competência a partir de 01/11/2026**, ME/EPP optantes pelo Simples Nacional emitem NFS-e pelo **Emissor Nacional (web ou API)**, mesmo que a prefeitura mantenha plataforma municipal. A regra não é baseada só em cidade ou na data de envio. Documentação oficial publicada em 29/10/2026: https://www.gov.br/nfse/pt-br/noticias/nfs-e-informa-diretrizes-sobre-a-obrigatoriedade-da-emissao-da-nfs-e-nacional-para-optantes-do-simples-nacional/
- Competências anteriores podem obedecer à via municipal conforme a regra temporal e o município. **Nunca converter automaticamente competências ou emitir por um provedor não confirmado.**
- O contrato da NFS-e deve selecionar a via com base em `municipio_ibge + regime_tributario + data_competencia` e validações cadastrais. A existência deste catálogo **não implementa esse roteamento**.

## Evidências de municípios-polo (05/11/2026)
| Cidade | Código IBGE | NFS-e — fonte e condição |
| --- | --- | --- |
| Maringá | 4115200 | Decreto municipal 2453/2025: cronograma de migração ao Emissor Nacional concluído em julho de 2026; https://nfse.ecity.maringa.pr.gov.br/ |
| Cianorte | 4105508 | Prefeitura anunciou Emissor Nacional para todos os prestadores desde 01/01/2026; https://cianorte.pr.gov.br/noticiasView/10581_Prestadores-de-servicos-devem-migrar-a-NFS-e-Nacional-ate-31-de-dezembro.html |
| Umuarama | 4128104 | Prefeitura manteve emissor municipal para casos aplicáveis; ME/EPP Simples segue obrigatoriedade nacional em competências desde 01/11/2026; https://umuarama.pr.gov.br/noticias/fazenda/nfs-e-ganha-novo-modelo-umuarama-mantm-sistema-prprio-de-emisso |
| Campo Mourão | 4104303 | Município informa webservice próprio; ME/EPP Simples com competência desde 01/11/2026 usa Emissor Nacional; https://www.campomourao.pr.gov.br/autoatendimento/servicos/acesso-ao-sistema-fiscal |
| Sarandi | 4126256 | Portal municipal Elotech; seu aviso confirma migração de ME/EPP Simples para o Emissor Nacional em 01/11/2026; https://sarandi.oxy.elotech.com.br/iss/home |
| Paranavaí | 4118402 | Comunicado municipal exige Emissor Nacional para ME/EPP Simples desde 01/11/2026; https://www.paranavai.pr.gov.br/cidadao/pagina/convocacoes |

As evidências acima não equivalem a homologação técnica do aplicativo: para cada combinação de município/regime é preciso validar manual/API, certificado, retorno autorizado, cancelamento e PDFs.

## Implementação da decisão fiscal no Oficina (PR DDD 44)
- O catálogo contém 124 municípios e geocódigos IBGE, sem filtrar o resto de PR.
- Na tela **Preparar documento > NFS-e**, a data de competência é informada pelo operador; o sistema consulta a rota no servidor antes de habilitar o rascunho.
- Decisão canônica em `src/platform/nfse-routing.js`, independente do DDD e sempre baseada no município IBGE do emitente, regime fiscal e data da competência.
- MEI desde 01/09/2023: Nacional (https://www.gov.br/nfse/pt-br/mei-prestadores-de-servico-de-todo-o-pais-estao-obrigados-a-emitir-nfs-e).
- ME/EPP Simples com competência a partir de 01/11/2026: Nacional, **inclusive município com emissor próprio**, conforme o comunicado de 29/10/2026. Competências anteriores não podem ser implicitamente enviadas ao Nacional em municípios que mantinham o sistema municipal.
- Maringá: ME/EPP Simples a partir de 01/05/2026 e demais prestadores a partir de 01/07/2026 usam Nacional; cronograma por tipo de prestador exige revisão profissional para datas anteriores. Fonte: https://nfse.ecity.maringa.pr.gov.br/
- Cianorte: Nacional para todos os prestadores a partir de 01/01/2026. Fonte: https://cianorte.pr.gov.br/noticiasView/10581_Prestadores-de-servicos-devem-migrar-a-NFS-e-Nacional-ate-31-de-dezembro.html
- Umuarama, Campo Mourão e Sarandi: rota Municipal para regimes e competências comprovados; em competências do Simples desde 01/11/2026 vale Nacional. Adaptadores municipais precisam declarar o IBGE correspondente.
- Outras combinações desconhecidas ficam **PENDENTE** e bloqueiam rascunho/transmissão; nenhuma prefeitura, ISS ou adaptação é inferida do telefone/DDD.
- O snapshot guarda `nfseRoute` e seu hash canônico. Reaproveitamento idempotente com competência diferente é recusado. Antes da transmissão, confronta-se a rota com a configuração atual, sem mudar o documento silenciosamente.
- Um emissor local ACBr/sidecar da empresa declara, em sua configuração confiável, `nfseChannel:"NACIONAL"` ou `nfseChannel:"MUNICIPAL"`; para Municipal exige `nfseMunicipalityIbge:"NNNNNNN"`. É proibido configurar isso a partir do navegador, e o modo de produção não substitui autorização fiscal.
- **Limitação expressa:** roteamento, prévia, validação e integração ao adaptador local implementados **não equivalem** ao envio de DPS/XML homologado no sistema nacional ou nos municípios. Antes de distribuição fiscal efetiva, são necessárias configuração do ACBrNFSe/API nacional, certificado, revisão tributária/códigos de serviço, ensaios com autorização, consulta, cancelamento, XML/DANFSe, e integrações municipais para os casos aplicáveis.
- UX: motivo de bloqueio exibido ao operador, sem limpar dados válidos; seleção de cidade autopreenche IBGE; rascunho indica competência e emissor escolhido; falha de canal ocorre antes de tentativa de transmissão.

## Matriz de homologação a manter por município
`municipio_ibge`, `municipio_nome`, `provedor_nfse_confirmado`, `emissor_nacional_disponivel`, `parametros_iss_validados`, `ambiente_homologado`, `credenciais_estabelecimento_configuradas`, `ultima_validacao`, `evidencias_xml_pdf`. Nenhum campo dessa matriz presume homologação.

## Referências
- IBGE, tabela oficial de códigos municipais: https://www.ibge.gov.br/explica/codigos-dos-municipios.php
- Anatel, áreas locais e numeração: https://www.gov.br/anatel/pt-br/regulado/competicao/tarifas-e-precos/areas-locais-da-telefonia-fixa
- Receita/PR, credenciamento NFC-e: https://sped.fazenda.pr.gov.br/NFCe/Pagina/Credenciamento-de-emissores
- NFS-e Nacional, documentação técnica: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
- Relação de DDD 44 usada como conferência cruzada: https://www.meuddd.com.br/ddd/44
