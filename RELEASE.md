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

O motor fiscal do ERP não está integrado neste P0; emissão real desativada.
