# NFS-e Nacional direta — implantação self-hosted

Esta integração é **R$ 0 de software obrigatório**, sem intermediários comerciais. O cliente precisa de sua própria inscrição/credenciamento e certificado digital fiscal válido; eventual custo do certificado é independente do sistema.

## O que está implementado

1. Cadastro fiscal por empresa/unidade e cofre local A1.
2. Geração assistida de DPS a partir do rascunho de serviço, perfil nacional `cTribNac` e parâmetros declarados pelo responsável fiscal.
3. SDK OSS MIT `@useinvio/nfse-sdk@3.0.0` incluído no runtime/instalador; usuário final não instala dependências.
4. Assinatura XMLDSig e transmissão `GZip/Base64` por mTLS à SEFIN; conciliação por `GET /dps/{id}` e `GET /nfse/{chave}`.
5. Consulta de DANFSe em PDF (legada) no ADN para nota autorizada, com checagem de chave e formato. A API foi suspensa em 03/08/2026: não é uma solução operacional de impressão.
6. Sem fallback para SaaS nem marcação de nota autorizada a partir de resposta incompleta.

## Endereços oficiais

- SEFIN homologação: `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional`
- SEFIN produção: `https://sefin.nfse.gov.br/SefinNacional`
- ADN DANFSe homologação: `https://adn.producaorestrita.nfse.gov.br/danfse/{chave}`
- ADN DANFSe produção: `https://adn.nfse.gov.br/danfse/{chave}`

## Configuração do administrador

Em instalação local gerenciada, o recurso continua **opt-in** em `OFICINA_NFSE_NACIONAL_DIRETA=true`. Em instalação específica por empresa, usar `TENANCY_FISCAL_CONFIG_FILE` com pasta de XML e pasta de certificados privadas e separadas por unidade. Não expor secrets na aplicação nem partilhar certificados entre empresas.

## Estado de homologação

O gerador automático funciona apenas no ambiente de homologação até validação oficial do leiaute de 2026. O SDK não implementa o bloco RTC/IBSCBS do XSD v1.01; o sistema não supõe dados tributários faltantes. Cancelamento com evento assinado e confirmação oficial ainda não está pronto. A consulta e download de DANFSe têm testes simulados, mas **não há evidência de operação real homologada**.

Liberação comercial exige testes com prestador real autorizado, certificado A1 do titular, parâmetros fiscais revisados, XSD vigente, prova de autorização/rejeição oficial, gerador local de DANFSe compatível com a NT 008/2026, reinício/backup e cancelamento fiscal confirmado. Os gates da `main` por modelo e por certificado devem permanecer ativos.

Documentação do padrão nacional: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
