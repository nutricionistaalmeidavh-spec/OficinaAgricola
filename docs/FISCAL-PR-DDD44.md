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

## Matriz de homologação a manter por município
`municipio_ibge`, `municipio_nome`, `provedor_nfse_confirmado`, `emissor_nacional_disponivel`, `parametros_iss_validados`, `ambiente_homologado`, `credenciais_estabelecimento_configuradas`, `ultima_validacao`, `evidencias_xml_pdf`. Nenhum campo dessa matriz presume homologação.

## Referências
- IBGE, tabela oficial de códigos municipais: https://www.ibge.gov.br/explica/codigos-dos-municipios.php
- Anatel, áreas locais e numeração: https://www.gov.br/anatel/pt-br/regulado/competicao/tarifas-e-precos/areas-locais-da-telefonia-fixa
- Receita/PR, credenciamento NFC-e: https://sped.fazenda.pr.gov.br/NFCe/Pagina/Credenciamento-de-emissores
- NFS-e Nacional, documentação técnica: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
- Relação de DDD 44 usada como conferência cruzada: https://www.meuddd.com.br/ddd/44
