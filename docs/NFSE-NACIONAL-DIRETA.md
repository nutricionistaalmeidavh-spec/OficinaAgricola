# NFS-e Nacional direta — implantação self-hosted

Esta integração é **R$ 0 de software obrigatório**, sem intermediários comerciais. O cliente precisa de sua própria inscrição/credenciamento e certificado digital fiscal válido; eventual custo do certificado é independente do sistema.

## O que está implementado

1. Cadastro fiscal por empresa/unidade e cofre local A1.
2. Geração assistida de DPS a partir do rascunho de serviço, perfil nacional `cTribNac` e parâmetros declarados pelo responsável fiscal.
3. SDK OSS MIT `@useinvio/nfse-sdk@3.0.0` incluído no runtime/instalador; usuário final não instala dependências.
4. Assinatura XMLDSig e transmissão `GZip/Base64` por mTLS à SEFIN; conciliação por `GET /dps/{id}` e `GET /nfse/{chave}`.
5. Geração de DANFSe local para XML oficial autorizado: PDF vetorial A4 de página única, QR Code de consulta nacional, aviso de homologação e leitura dos campos do XML, integrado ao botão de PDF sem uso da API suspensa em 03/08/2026. Dependência QR MIT `qrcode-generator@2.0.4`, empacotada.
6. Sem fallback para SaaS nem marcação de nota autorizada a partir de resposta incompleta.

## Endereços oficiais

- SEFIN homologação: `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional`
- SEFIN produção: `https://sefin.nfse.gov.br/SefinNacional`
- QR de consulta pública: `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave={chave}`
- A antiga API `/danfse` permanece somente no adaptador legado e não é chamada pela impressão.

## Configuração do administrador

Em instalação local gerenciada, o recurso continua **opt-in** em `OFICINA_NFSE_NACIONAL_DIRETA=true`. Em instalação específica por empresa, usar `TENANCY_FISCAL_CONFIG_FILE` com pasta de XML e pasta de certificados privadas e separadas por unidade. Não expor secrets na aplicação nem partilhar certificados entre empresas.

## Estado de homologação

O gerador automático funciona apenas no ambiente de homologação até validação oficial do leiaute de 2026. O SDK não implementa o bloco RTC/IBSCBS do XSD v1.01; o sistema não supõe dados tributários faltantes. Cancelamento com evento assinado e confirmação oficial ainda não está pronto. Os testes simulados verificam a geração PDF local e bloqueio de chaves/CNPJs/ambientes divergentes, mas **não há evidência de operação real homologada nem revisão de conformidade gráfica completa da NT 008 v1.02**.

Liberação comercial exige testes com prestador real autorizado, certificado A1 do titular, parâmetros fiscais revisados, XSD vigente, prova de autorização/rejeição oficial, revisão visual do DANFSe local contra o Anexo I da NT 008/2026 (logomarca oficial e tipografia exigida), reinício/backup e cancelamento fiscal confirmado. Os gates da `main` por modelo e por certificado devem permanecer ativos.

Documentação do padrão nacional: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
