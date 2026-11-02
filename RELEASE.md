# ArtiSys Oficina — Entrega P0

Produto novo para instalação limpa, baseado no sistema único do repositório.

## Identidade do aplicativo
- Nome: ArtiSys Oficina
- ID: com.artisys.oficina
- Setup: `ArtiSys-Oficina-Setup-1.0.0-Windows-x64.exe`
- Banco Windows: `%LOCALAPPDATA%\\ArtiSys\\Oficina\\data\\artisys-oficina.sqlite`
- Anexos Windows: `%LOCALAPPDATA%\\ArtiSys\\Oficina\\storage\\uploads`
- Banco CLI: `data/artisys-oficina.sqlite`
- Porta local: 3344

Não reaproveitar dados de OficinaAgro ou AssistenciaTecnica. Nenhum instalador é publicado automaticamente.

## Gates obrigatórios
`npm run ci`, GitHub Actions CI e QA visual Playwright em matriz desktop/mobile. Somente gerar instalador para distribuição após aprovar o PR e conferir gates.

## Validações C1 — instalação e segurança

- Primeiro acesso em máquina limpa não cria senha de administrador padrão; o responsável configura usuário e senha forte localmente.
- A API de configuração inicial só permite `localhost` e um único administrador inicial.
- GitHub Actions CI e QA visual desktop/mobile obrigatórios no processo; workflow Windows gera NSIS com `--publish never` e testa instalação/primeiro acesso em VM limpa.
- O workflow Windows não publica Releases e não entrega instalador a clientes automaticamente. A validação em hardware físico ainda é responsabilidade da entrega comercial.
- Configurar proteção de `main` conforme [docs/PROTEGER-MAIN.md](docs/PROTEGER-MAIN.md); a conexão GitHub do agente não possui acesso administrativo às configurações.
- Equipamentos/veículos: placa, VIN, km, registros de revisão e garantia com vínculo opcional à OS. Fiscal continua desativado.

O motor fiscal do ERP não está integrado neste P0; emissão real desativada.
