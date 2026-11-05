# NFS-e Nacional — API direta SEFIN / ADN

## Arquitetura entregue na PR #51

- Núcleo self-hosted, sem API comercial e sem SaaS pago.
- SDK `@useinvio/nfse-sdk@3.0.0` (MIT) instalado junto com as dependências Node no build; o cliente final NÃO instala SDK.
- No instalador Windows, `scripts/stage-nfse-national.mjs` copia e valida o módulo em `build/nfse-national`; `electron-builder.yml` incorpora os arquivos a `resources/nfse-national`.
- Geração assistida da DPS a partir do snapshot fiscal da OS, perfis de serviço e parâmetros declarados pelo responsável fiscal. O SDK monta XML, assina XMLDSig com o certificado A1 local e verifica a assinatura.
- Restrita à homologação no gerador automático. Não infere regime, códigos municipais, ISS, IBS ou CBS.
- Envio mTLS para SEFIN (`POST /nfse`) e consulta pela DPS e chave. Não existe repetição automática de POST após timeout.
- Existe uma implementação de consulta de DANFSe pelo ADN, com mTLS A1 e validação de PDF, mas a API pública foi suspensa em 01/07/2026 (NT 008/2026). A impressão fiscal compatível exige gerador próprio conforme leiaute vigente; esta implementação não conclui essa entrega.
- Certificado A3 e emissão NF-e/NFC-e seguem os adaptadores ACBr existentes.

## Segurança e ativação

Instalação Windows gerenciada usa opt-in de administrador `OFICINA_NFSE_NACIONAL_DIRETA=true`, após validação do bundle ACBr, e diretório privado por empresa/unidade. Sem a opção, comportamento anterior permanece.

Instalação PostgreSQL por empresa pode utilizar configuração confiável `TENANCY_FISCAL_CONFIG_FILE` com emissor `type=nacional`, `cnpj`, `inputDir` e `certificateDir` isolados. Não publicar esses caminhos, senhas ou conteúdo de certificados.

Se a DPS já vier assinada de fora, o upload manual permanece disponível, mas a validação manual de estrutura e presença de SignatureValue NÃO equivale à validação criptográfica da assinatura; usar o gerador automático com A1 quando apropriado.

## Limites que ainda impedem produção

**Não está comprovada a homologação com prestador/certificado reais.** A SDK 3.0.0 não implementa o bloco RTC/IBSCBS do XSD nacional v1.01 (2026). Portanto, os casos que dependam dessas informações não podem ser considerados conformes. Testes simulados não liberam produção.

Faltam: validação de ponta a ponta contra os XSD e regras oficiais vigentes, tratamento fiscal completo de descontos/retenções e casos municipais, cancelamento e eventos assinados com confirmação oficial, cobertura de municípios e regimes, restauração e testes reais após reinício.

O cliente não deve alterar arquivos fiscais ou executar comandos técnicos. Cadastrar CNPJ, município, regime, certificado A1 e parâmetros declaratórios deve ocorrer pela interface. As etapas que ainda exigem configuração técnica e homologação estão explicitadas como pendências, nunca consideradas concluídas.

## Qualidade

`npm ci && node scripts/stage-nfse-national.mjs && npm run ci`

CI valida bundle SDK em Linux e Windows; validação do instalador Electron completo precisa de executor Windows com toolchain fiscal e PostgreSQL. A homologação real exige CNPJ/certificado e autorização legítimos; nunca utilizar certificados de outro contribuinte.

Documentos oficiais: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
