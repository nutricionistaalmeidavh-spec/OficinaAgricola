# Fiscal ACBr — emissão auditada, cancelamento e DANFE/DANFSe

## Estado e pré-requisitos

A infraestrutura ACBrLib NF-e/NFS-e e o PostgreSQL 16 são empacotados no instalador Windows x64. O core do ArtiSys Oficina continua R$ 0, open source e self-hosted. **O empacotamento do ACBr não constitui homologação fiscal.**

O módulo fiscal inicia em homologação e é habilitado automaticamente após o cadastro válido da empresa. O certificado A1 é importado pelo cliente na interface, fica cifrado no cofre local da unidade e só é descriptografado em arquivos temporários durante a execução do ACBr. O fluxo assistido A3 ainda não foi homologado. Emissão real requer homologação junto à SEFAZ e, para NFS-e, ao município ou emissor nacional conforme a localidade. Nenhum certificado, senha, chave ou segredo deve entrar no GitHub, no frontend ou na revisão tributária.


## Diagnóstico do cliente no próprio aplicativo

1. Configuração Fiscal: CNPJ, UF, IBGE, IE/IM, regime e ambiente.
2. Certificado A1: importar PFX/P12 e senha; cofre local por unidade, sem banco ou Git.
3. Testar SEFAZ: obter certificados pelo ACBr, comparar o CNPJ e consultar o status real de serviço no ambiente selecionado.
4. Criar rascunho NF-e, revisar os tributos e transmitir em homologação. Registrar XML/protocolo real e verificar consulta, cancelamento e PDF.
5. Produção continua separada: serviço SEFAZ online não comprova emissão, credenciamento ou habilitação de NFS-e.

**Pendências para release fiscal pleno:** homologação real com credenciais de contribuinte, sequência fiscal e validações tributárias completas, prestadores municipais de NFS-e e suporte A3. Não declarar conformidade com base apenas no CI. O core permanece R$ 0, self-hosted e open source.

## Fluxo NF-e

1. Criar rascunho a partir de uma OS aprovada; o servidor congela o snapshot e hash, sem gravar outra receita/estoque.
2. **Revisão tributária obrigatória:** usar a ação **Revisar tributação** do rascunho NF-e para informar NCM, CFOP, CST/CSOSN, PIS/COFINS, endereço do emitente/destinatário e número/série. O backend monta a revisão por unidade, sem exigir arquivos JSON/INI manuais.
3. O gerador converte a revisão em INI de NF-e e manifesto a partir do snapshot canônico, usando os campos ACBr cProd, xProd, qCom, vUnCom, vProd, vDesc e vNF. Não inventa tributos ou CFOP; exige igualdade exata dos valores.
4. Transmitir pela UI, apenas com emissor ACBr explicitamente configurado. A lib carrega o INI, assina, valida esquema, persiste XML assinado de recuperação e envia à SEFAZ.
5. O serviço só muda para `AUTORIZADA` depois de conferir ambiente, chave, número, série, protocolo e XML de autorização assinado/processado.
6. Timeout ou resposta incompleta: `INDETERMINADO`, sem retransmissão cega; selecionar **Consultar situação**.
7. Em nota autorizada, **DANFE/PDF** usa o XML autorizado e `NFE_SalvarPDF`. O arquivo é obtido por resposta binária autenticada.
8. Usuário ADMIN pode solicitar cancelamento com motivo de 15 a 255 caracteres. O pedido é registrado antes do acesso à SEFAZ, e a confirmação exige chave, ambiente, protocolo e XML do evento.
9. Se o cancelamento ficar inconclusivo, usar **Consultar situação**; a aplicação nunca envia um segundo evento automaticamente. XML da NF-e original permanece disponível para auditoria mesmo se o status virar `CANCELADA`.

Exemplo **estrutural** de `.review.json`, sem representar regras tributárias para uso real:

```json
{
  "kind": "NFE",
  "documentId": 4,
  "snapshotHash": "substituir-pelo-sha256-canonico",
  "issuerCnpj": "cnpj-real-da-empresa",
  "environment": "HOMOLOGACAO",
  "amountCents": 8000,
  "sections": {
    "infNFe": {"versao": "4.00"},
    "Identificacao": {"mod": "55", "serie": "serie-real", "nNF": "numero-real", "tpAmb": "2"},
    "Emitente": {"CNPJCPF": "cnpj-real-da-empresa"},
    "Destinatario": {"CNPJCPF": "documento-do-tomador"},
    "Produto001": {"NCM": "ncm-revisado", "CFOP": "cfop-revisado"},
    "ICMS001": {"CSOSN": "codigo-revisado"},
    "PIS001": {"CST": "codigo-revisado"},
    "COFINS001": {"CST": "codigo-revisado"},
    "Total": {"ValorProduto": "90.00", "ValorDesconto": "10.00", "ValorNota": "80.00"}
  }
}
```

O exemplo omite campos obrigatórios de endereço, classificação, impostos, IBS/CBS quando aplicáveis e demais campos próprios da operação. **Não usar os placeholders para emissão.** O compilador exige NCM de 8 dígitos, CFOP de 4 dígitos, coerência de CNPJ e totais; a validação XML/SEFAZ é etapa adicional.

## NFS-e

A assinatura e transmissão via `NFSE_Emitir` e a consulta de RPS já existiam; DANFSe via `NFSE_SalvarPDF` foi adicionado. O INI de NFS-e permanece dependente da regra de serviço e do município; sua geração automática **não está liberada como padrão nacional**.

Há um contrato de pedido de cancelamento `NFSE_Cancelar` que depende de um INI municipal `.cancel.ini` revisado. O aplicativo **não marca NFS-e cancelada apenas porque um provedor retornou sucesso no recebimento do evento**. A confirmação de status final requer integração específica para o prestador/município.

## Gates de distribuição

- CI, QA visual, integração PostgreSQL e D1, build NSIS Windows limpo e primeiro login.
- Ensaio do ACBr nativo em homologação com um emitente real, certificado e credenciamento da oficina.
- Testar XML autorizado e protocolo, DANFE/DANFSe, cancelamento com evento oficial, backup/restore e impressão física.
- Testar cenários de consulta após timeout sem duplicar documento/evento.
- Nenhuma operação de produção/SEFAZ é executada em CI.
- Não publicar instalador comercial só com mocks, compilação da DLL ou testes de VM.

## Referências oficiais

- [ACBrLib — como emitir NF-e/NFC-e](https://acbr.sourceforge.io/ACBrLib/ComoemitirumaNFeouNFCe.html)
- [ACBrLib — NFE_Cancelar](https://acbr.sourceforge.io/ACBrLib/NFE_Cancelar.html)
- [ACBrLib — NFE_SalvarPDF](https://acbr.sourceforge.io/ACBrLib/NFE_SalvarPDF1.html)
- [ACBrLib — NFSE_Cancelar](https://acbr.sourceforge.io/ACBrLib/NFSE_Cancelar.html)
- [ACBrLib — NFSE_SalvarPDF](https://acbr.sourceforge.io/ACBrLib/NFSE_SalvarPDF.html)
