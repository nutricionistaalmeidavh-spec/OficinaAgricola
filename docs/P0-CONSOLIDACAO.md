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
`npm run ci`, GitHub Actions CI e QA visual desktop/mobile (Playwright), suíte HTTP E2E, testes de C0/C1 e build manual Windows. CircleCI não faz parte da configuração do projeto. Não realizar merge nem publicação sem todos os gates confirmados.

## Limites
- Módulo fiscal não foi conectado à oficina nesta fase.
- Unificação não é a migração automática de bases de clientes distintas.
- Confirmação real de hardware/impressoras e homologação fiscal não fazem parte do P0.

## Perfil multimarcas (branch P0)

- O mesmo banco e runtime oferecem perfis MISTA, AUTOMOTIVA e AGRICOLA, configuráveis na empresa, sem migração destrutiva e sem mudança de ID de instalação.
- Veículos: placa, VIN, RENAVAM (formato de 11 dígitos, sem consulta DETRAN), motorização, combustível, km e horímetro.
- Peças: cadastro de aplicações por marca/modelo/faixa de ano/motor/combustível. Apenas aplicações explícitas aparecem na consulta; elas NÃO confirmam homologação OEM.
- OBD-II: leitura de DTCs armazenados via ELM327 USB/serial (Web Serial) no PC principal, com comandos somente leitura e captura opcional da OS. Requer dispositivo físico compatível e avaliação em veículo real; sem adapter, não há captura real. Suporta quadro mode 03 com e sem contador CAN; não executa apagamento de DTCs ou escrita na ECU.
- Manutenção: planos com vencimento por qualquer limite atingido (data/km/horas), alertas locais na Agenda, registro de execução e recálculo dos próximos marcos, com histórico vinculado ao veículo/OS. Alertas são calculados ao consultar, sem push remoto.
- Núcleo local R$0. Não adiciona dependência, serviço externo ou segredo. Integração fiscal real continua independente e desativada.
