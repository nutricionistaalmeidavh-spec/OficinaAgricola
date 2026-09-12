# ArtiSys QA — Oficina Agro

A Etapa 07 consome o módulo `@artisys/qa` do repositório `utilidades` como ferramenta de desenvolvimento e validação. Ele não é dependência de runtime do Oficina Agro.

## Fluxos

- `stage7-shell`: smoke visual público da tela de login; é o fluxo padrão.
- `stage7-dashboard`: valida o dashboard autenticado, busca global, pipeline de OS e snapshot visual opcional.

Para o fluxo autenticado, defina somente no ambiente de QA:

```bash
export ARTISYS_QA_USERNAME=admin
export ARTISYS_QA_PASSWORD='senha-do-ambiente-de-qa'
```

O snapshot visual só é comparado quando `ARTISYS_QA_VISUAL=1`. Para criar/atualizar baseline de forma explícita, use também `ARTISYS_QA_UPDATE_VISUAL_BASELINES=1`.

## Execução local self-hosted

Com o repositório `utilidades` disponível localmente, execute o CLI do módulo apontando para `qa/artisys-qa.config.json`. A configuração inicia banco temporário em `.qa/`, roda a aplicação localmente e não depende de SaaS.

O workflow GitHub incluído é opcional e pinado a um commit específico do módulo. O funcionamento do produto não depende dele.
