# NFS-e Nacional — API direta (SEFIN) — etapa de integração

## Objetivo e limite desta entrega

Implementação inicial **self-hosted / open source / R$ 0 de API intermediária** para envio de DPS *previamente assinada*, consulta por identificador DPS e consulta por chave NFS-e. O backend usa HTTPS mTLS com certificado A1 mantido em cofre local por empresa/unidade. Não usa API comercial.

**Não está homologada com documento real. Não liberar produção apenas por testes unitários.** O instalador/servidor não gera XML completo da DPS, não assina o XMLDSig nem valida o XSD nacional automaticamente; o operador responsável deve preparar DPS assinada válida. O validador local confere presença de `SignatureValue`, CNPJ, município, competência, série, número e valor, mas **não faz a verificação criptográfica XMLDSig**; a SEFIN deve validar o documento. Não se presume autorização se faltarem chave e XML oficial.

**Cancelamento**: o cliente HTTP suporta registro de evento previamente assinado, mas não há processo de cancelamento integrado ao fluxo operacional nem confirmação de evento oficial. Continua bloqueado para o provedor direto; não afirmar que está concluído. **DANFSe em PDF**: ainda não implementado no provedor direto. O download existente não deve afirmar suportar NFS-e direta.

## Ativação explícita

### Instalação PostgreSQL por empresa

Configuração do servidor em `TENANCY_FISCAL_CONFIG_FILE` (arquivo local confiável, fora de repositórios públicos):

```json
{
  "1": {
    "type": "nacional",
    "cnpj": "11222333000181",
    "nfseChannel": "NACIONAL",
    "inputDir": "/var/lib/oficina/empresa-1/unidade-1/nfse",
    "certificateDir": "/var/lib/oficina/empresa-1/unidade-1/certificados"
  }
}
```

Use CNPJ real e diretórios privados específicos por empresa, com backup cifrado e controles do sistema operacional. O serviço exige certificado A1; seleção A3 permanece no adaptador ACBr. Não compartilhar os diretórios entre empresas.

### Instalação Windows local gerenciada

A opção `OFICINA_NFSE_NACIONAL_DIRETA=true` ativa a API direta **somente** quando o bundle fiscal ACBr validado já estiver disponível e o diretório privado por unidade estiver configurado; não é requisito universal da aplicação. Sem essa opção, o fluxo ACBr anterior permanece inalterado. Não alterar secrets existentes. A opção é de configuração da instalação e não pode ser ativada por requisição HTTP do cliente.

## Processo operacional

1. O operador cadastra CNPJ, município IBGE, regime e ambiente fiscal e instala um certificado A1 da própria empresa no cofre.
2. A OS aprovada gera rascunho NFS-e com snapshot imutável, data de competência e seleção de canal nacional.
3. Em `Fiscal → DPS Nacional`, o administrador anexa o XML da DPS já assinado. O arquivo fica isolado por empresa/unidade e vinculado ao snapshot; não é substituído após preparo.
4. O botão **Transmitir** usa mTLS local, `POST /nfse` e corpo `dpsXmlGZipB64`. Um erro de rede deixa o documento como **INDETERMINADO**; é proibido repetir POST cegamente.
5. **Conciliar** consulta primeiro `GET /dps/{idDps}` e depois `GET /nfse/{chaveAcesso}`; só confirma a nota quando há retorno oficial íntegro.
6. Rejeições explicitadas como HTTP 400 com erros fiscais são registradas como rejeição; outras respostas são inconclusivas.

## Ambientes oficiais e segurança

- Homologação: `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional`
- Produção: `https://sefin.nfse.gov.br/SefinNacional`
- Referência: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
- Leiaute nacional, esquemas XSD e manuais: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual

O destino HTTPS é fixo; mTLS usa certificado local, sem configuração remota de endpoints nem proxy. Arquivos com PFX/senha não devem ser enviados no cadastro de DPS. O cofre atual protege A1 com AES-256-GCM.

## Pendências para liberação ao cliente

- Gerar DPS a partir dos campos da tela em conformidade com o XSD vigente, regras municipais e parâmetros tributários, e assinar XMLDSig com A1/A3.
- Validar assinatura e XSD antes de enviar, sem substituir a confirmação oficial da SEFIN.
- Homologar transmissão, rejeições, conciliação, reinício e recuperação de erro com certificado credenciado e prestador real.
- Implementar cancelamento com evento assinado, consulta do evento e comprovante oficial, além de DANFSe/PDF oficial.
- Validar parametrização municipal/regime/tributação com o responsável fiscal e testar com os seis estados preparados.
- Não liberar produção enquanto esses critérios não estiverem aprovados.

## QA

- `node --test tests/nfse-national-direct.test.js tests/nfse-national-dps-store.test.js`
- CI completo do repositório e workflow de paridade após a abertura da PR.
