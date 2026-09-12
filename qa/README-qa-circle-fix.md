# Correção do QA no CircleCI

Os jobs `qa-desktop` e `qa-mobile` passam a usar o runner local `scripts/qa-demo.mjs` e Playwright instalado temporariamente no próprio job. Eles não clonam mais o repositório privado `utilidades` e não dependem de chave SSH.

O manifesto `qa/artisys-qa.config.json` também foi ajustado para iniciar seed e servidor a partir da raiz do projeto, garantindo que ambos usem `.qa/oficina.sqlite` e `.qa/uploads`.
