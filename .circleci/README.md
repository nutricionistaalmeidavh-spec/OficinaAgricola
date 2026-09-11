# CircleCI — OficinaAgricola

O GitHub continua sendo a fonte única do código. O CircleCI é um executor remoto opcional para CI e QA e não é dependência de runtime, build local ou distribuição do sistema.

## Pipeline

A configuração em `.circleci/config.yml` executa:

- `quality`: `npm ci`, lint, testes, build e E2E crítico usando o mesmo comando `npm run ci` disponível localmente.
- `qa-desktop`: ArtiSys QA 2.4.1 com Chromium/Playwright no fluxo `stage7-shell`.
- `qa-mobile`: o mesmo fluxo QA no viewport mobile.

Os jobs de QA só começam depois que `quality` estiver verde.

## Ativação no CircleCI

1. Abra o projeto `OficinaAgricola` no CircleCI.
2. Use a configuração existente no repositório: `.circleci/config.yml`.
3. Use `main` como branch padrão/configuração.
4. Garanta que o projeto tenha acesso somente-leitura ao repositório privado `nutricionistaalmeidavh-spec/utilidades`.

## Acesso ao `utilidades`

O QA não é copiado para este repositório. O job faz checkout do commit fixado do `utilidades` para manter uma fonte única do kit ArtiSys QA.

Como `utilidades` é privado, o CircleCI precisa de uma chave com acesso de leitura a esse repositório. A opção recomendada é uma chave SSH dedicada somente-leitura:

1. Crie uma chave SSH sem senha exclusivamente para CI.
2. Adicione a chave pública como Deploy Key de leitura no repositório `utilidades`.
3. Em `OficinaAgricola` no CircleCI, adicione a chave privada em Project Settings > SSH Keys > Additional SSH Keys, com hostname `github.com`.

O passo `add_ssh_keys` já está presente no job QA. Nenhuma credencial de produção, Cloudflare, Drive ou banco deve ser colocada no YAML.

## Execução local

O gate principal continua executável sem CircleCI:

```bash
npm ci
npm run ci
```

O GitHub Actions existente também permanece ativo. CircleCI não substitui nem remove o caminho local/self-hosted ou o GitHub Actions.
