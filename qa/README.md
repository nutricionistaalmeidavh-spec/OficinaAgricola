# ArtiSys QA — ArtiSys Oficina

A edição ArtiSys Oficina pode consumir o módulo `@artisys/qa` do repositório `utilidades` como ferramenta opcional de desenvolvimento e validação. Ele não é dependência de runtime do produto.

## Fluxos

- `stage7-shell`: smoke visual público da tela de login; é o fluxo padrão.
- `stage7-dashboard`: valida dashboard autenticado, busca, pipeline de OS e snapshot visual opcional.

Para o fluxo autenticado, use credenciais somente no ambiente de QA:

```bash
export ARTISYS_QA_USERNAME=admin
export ARTISYS_QA_PASSWORD='senha-do-ambiente-de-qa'
```

O snapshot visual só é comparado quando `ARTISYS_QA_VISUAL=1`. Para criar ou atualizar baseline explicitamente, use também `ARTISYS_QA_UPDATE_VISUAL_BASELINES=1`.

## Execução local self-hosted

Com o repositório `utilidades` disponível localmente, execute o CLI apontando para `qa/artisys-qa.config.json`. A configuração usa a porta `3344`, banco temporário em `.qa/` e execução local. Nenhum SaaS é necessário para o produto funcionar.
