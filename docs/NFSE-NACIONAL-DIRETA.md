# NFS-e Nacional direta — integração opt-in, gratuita, self-hosted

A implementação usa exclusivamente HTTPS do Node.js, GZip da biblioteca padrão e o cofre local A1 já existente. Não exige SaaS, API paga, assinatura de intermediário ou nova credencial externa.

## Referências oficiais em 05/11/2026
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf

### Endpoints SEFIN Nacional (não confundir com ADN)
Homologação: https://sefin.producaorestrita.nfse.gov.br/SefinNacional
Produção: https://sefin.nfse.gov.br/SefinNacional

- POST /nfse: JSON com DPS assinada compactada no campo dpsXmlGZipB64 (GZip/Base64).
- GET /dps/{id}: concilia por identificador de DPS antes de reenviar.
- GET /nfse/{chaveAcesso}: recupera XML da NFS-e.
- POST /nfse/{chaveAcesso}/eventos: envia pedido de evento assinado; HTTP 201 sozinho não comprova cancelamento.

O backend restringe destinos aos hosts oficiais, usa mTLS A1, verifica ambiente, CNPJ, IdDPS, chave e XML, rejeita redirecionamentos e limita respostas. Não faz retry automático de POST.

## Ativação expressa (não muda instalações existentes)

Em instalação gerenciada Windows self-hosted, administrador pode ajustar OFICINA_NFSE_NACIONAL_DIRETA=true no ambiente privado do backend. Apenas o documento NFS-e nacional será enviado pela nova API; mercadorias continuam via ACBr. Com a opção desabilitada, nada muda.

Em deploy self-hosted por empresa via TENANCY_FISCAL_CONFIG_FILE, utilizar type=nacional, nfseChannel=NACIONAL, cnpj, inputDir e certificateDir como caminhos absolutos e privados por empresa/unidade. O tipo nacional serve a operações NFS-e somente. Arquivos e cofre não podem ser compartilhados entre empresas.

## Fluxo disponível no aplicativo

1. Configure CNPJ, UF, município, regime, certificado A1 e competência fiscal.
2. Crie rascunho de NFS-e de serviços, que salva a rota NACIONAL no snapshot canônico.
3. Em DPS Nacional, anexe um XML de DPS previamente assinado. O servidor valida CNPJ, município, competência, Id DPS e valor dos serviços; a edição é bloqueada após preparo.
4. Ao transmitir, o servidor usa certificado A1 do cofre local, GZip e a API oficial. Apenas XML oficial que corresponda ao documento pode resultar em AUTORIZADA.
5. Em timeout ou resposta indefinida, consulte pelo Id DPS e pela chave; nunca reenvie automaticamente.
6. O PDF auxiliar DANFSe não está incluído no modo direto nesta fase.

## Limites de segurança e homologação

ATENÇÃO: A geração e assinatura AUTOMÁTICA da DPS no Oficina, incluindo leiaute XSD/IBS/CBS vigente, não estão implementadas nesta fase. Exige DPS assinada previamente por meio apropriado. O backend verifica estrutura e vínculo, mas a presença de SignatureValue não é verificação criptográfica; a validação final é feita pela SEFIN.

Também não estão disponíveis nesta fase: cancelamento automático na interface com evento assinado e confirmação oficial, substituição, pagamento/código municipal consultado dinamicamente, todas as regras de descontos e retenções, PDF via ADN e homologação real com certificado/credenciamento. Emissões com desconto exigem tratamento fiscal específico e ficam bloqueadas no fluxo simplificado.

A3 permanece na integração ACBr; não há conversão automática da chave de cartão ou token em PFX. A opção nacional direta exige A1 e não deve ser ativada silenciosamente.

Testes CI com respostas simuladas NÃO equivalem a emissão em produção restrita ou credenciamento. A aplicação não publica nem promove versão de produção automaticamente.

Backup obrigatório: PostgreSQL + pastas privadas de certificados, DPS e XML; não expor segredos nem alterar login/OAuth. Núcleo R$0, open source, self-hosted; eventual custo de certificado digital do cliente é separado e explícito.
