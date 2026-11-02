# P0 — Consolidação para um sistema ArtiSys Oficina

A base canônica é a antiga Assistência Técnica ArtiSys, promovida de `apps/assistencia-tecnica` para a raiz. A base antiga de oficina agrícola continua disponível no histórico Git. O aplicativo único mantém suporte a tipos de equipamento cadastráveis, inclusive tratores e máquinas.

## Mudanças P0
1. Vendas protegem estoque agregado por peça e usam atualização condicional transacional.
2. Caixa aberto obrigatório para novas vendas e estornos. Quando a venda pertence a caixa fechado, o estorno é registrado no **caixa corrente**, sem alterar fechamento anterior.
3. `requestId` persistido com índice único e fingerprint para reenvios. A mesma chave com payload diferente é recusada.
4. Backup usa `VACUUM INTO`, que considera transações do WAL. Restaurar banco exige parada da aplicação.
5. Um único `src/start.js`, `package.json`, `electron/main.js`, `public/`, `src/`, `tests/` no checkout.

## Proteção de dados
- Nenhum banco real foi copiado, convertido, mesclado ou excluído na operação de código.
- Resolver da execução escolhe apenas uma fonte existente. Múltiplas fontes causam erro explícito.
- No Windows, são detectadas as pastas legadas OficinaAgro e AssistenciaTecnica.
- Dois bancos com dados distintos não podem ser mesclados por substituição de arquivo: exigir migração dedicada com preservação das referências.
- A cópia do banco histórico não é obrigatória para operar com a única fonte detectada.
- Manter o banco e anexos antigos intactos até validar fluxo completo e backup.

## Gates
`npm run ci`, QA desktop/mobile CircleCI, suíte HTTP E2E, testes P0 e build manual Windows. Não realizar merge nem publicação sem todos os gates confirmados.

## Limites
- Módulo fiscal não foi conectado à oficina nesta fase.
- Unificação não é a migração automática de bases de clientes distintas.
- Confirmação real de hardware/impressoras e homologação fiscal não fazem parte do P0.
