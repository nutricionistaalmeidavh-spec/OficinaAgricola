# Proteção da main — GitHub Actions exclusivamente

**Estado verificado em 2026-11-02:** a branch `main` está com `protected=false` e a API de rulesets retorna `[]`. A integração GitHub deste atendimento é somente operações de repositório/PR e **não permite modificar configurações administrativas de branch protection, GitHub Apps ou webhooks**.

## Ativar proteção (uma única vez com proprietário/admin)

1. Abra https://github.com/nutricionistaalmeidavh-spec/OficinaAgricola/settings/branches
2. Crie a regra de proteção para `main` (ou ruleset direcionado à branch `main`).
3. Marque **Require a pull request before merging**.
4. Marque **Require status checks to pass before merging**.
5. Selecione somente os checks de GitHub Actions que aparecem após rodar um PR:
   - `quality` do workflow `CI`;
   - `visual-shell (desktop)` do workflow `ArtiSys QA · Etapa 07`;
   - `visual-shell (mobile)` do workflow `ArtiSys QA · Etapa 07`.
6. Exija que o PR esteja atualizado com a `main` antes de mesclar, quando disponível.
7. **Não** marque `CircleCI Pipeline`, `ci/circleci: quality`, `qa-desktop` ou `qa-mobile` do CircleCI.
8. Para a primeira entrega Windows, confira também o job `NSIS · Windows x64 limpo`. Ele roda em alterações pertinentes ao instalador/código; sua execução não é obrigatória para mudanças puramente documentais.

## CircleCI externo

Nenhum arquivo `.circleci` resta no código. Para impedir que o CircleCI continue reportando status externo `error`, desconecte o projeto em CircleCI (Project Settings → Overview → Stop Building, se OAuth), ou remova os triggers/integração pelo GitHub App. Isso exige acesso de administrador à plataforma e **não pode ser feito pela conexão GitHub disponível neste atendimento**.

## Princípio de entrega

O núcleo da oficina segue Node.js/SQLite local, open source/self-hosted, sem SaaS pago obrigatório. GitHub Actions é apenas ferramenta de desenvolvimento/QA e consome a cota da conta; nenhum artefato é publicado automaticamente. Os instaladores são gerados para validação, não distribuídos por release.
