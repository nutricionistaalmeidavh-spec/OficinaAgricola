# P0 — Consolidação para um sistema ArtiSys Oficina

A base canônica é a antiga Assistência Técnica ArtiSys, promovida de `apps/assistencia-tecnica` para a raiz. A base antiga de oficina agrícola continua disponível no histórico Git. O aplicativo único mantém suporte a tipos de equipamento cadastráveis, inclusive tratores e máquinas.

## Mudanças P0
1. Vendas protegem estoque agregado por peça e usam atualização condicional transacional.
2. Caixa aberto obrigatório para novas vendas e estornos. Quando a venda pertence a caixa fechado, o estorno é registrado no **caixa corrente**, sem alterar fechamento anterior.
3. `requestId` persistido com índice único e fingerprint para reenvios. A mesma chave com payload diferente é recusada.
4. Backup usa `VACUUM INTO`, que considera transações do WAL. Restaurar banco exige parada da aplicação.
5. Um único `src/start.js`, `package.json`, `electron/main.js`, `public/`, `src/`, `tests/` no checkout.

## Identidade nova e dados isolados
A distribuição chama-se **ArtiSys Oficina** (appId `com.artisys.oficina`).
Instalador: `ArtiSys-Oficina-Setup-<versão>-Windows-x64.exe`.
Dados Windows: `%LOCALAPPDATA%\\ArtiSys\\Oficina\\data\\artisys-oficina.sqlite`.
Anexos Windows: `%LOCALAPPDATA%\\ArtiSys\\Oficina\\storage\\uploads`.

- O desktop não detecta bancos de `OficinaAgro` nem `AssistenciaTecnica`, ainda que existam.
- Na execução pelo terminal, os caminhos padrão são `data/artisys-oficina.sqlite` e `storage/uploads`.
- Não há migração ou importação silenciosa. A aplicação cria seu próprio banco ao iniciar.
- Arquivos históricos das aplicações antigas não são apagados nem alterados.
- `DATABASE_PATH` explicitamente informado é aceito apenas pela execução via terminal para desenvolvimento ou QA.
- **Premissa de implantação:** computadores novos, sem instalações anteriores.

## Gates
`npm run ci`, QA desktop/mobile CircleCI, suíte HTTP E2E, testes P0 e build manual Windows. Não realizar merge nem publicação sem todos os gates confirmados.

## Limites
- Módulo fiscal não foi conectado à oficina nesta fase.
- Unificação não é a migração automática de bases de clientes distintas.
- Confirmação real de hardware/impressoras e homologação fiscal não fazem parte do P0.
