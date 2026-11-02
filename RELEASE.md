# Assistência Técnica ArtiSys · Release 1.0.0

## Escopo

Esta release consolida as Entregas 00–14 da edição Assistência Técnica sem alterar a identidade nem os dados da aplicação Oficina Agrícola da raiz do repositório.

## Critérios obrigatórios

1. `assistencia_quality` verde.
2. `assistencia-qa-desktop` verde.
3. `assistencia-qa-mobile` verde.
4. branch `release/assistencia-v1.0.0` criada somente após o merge final em `main`.
5. `assistencia_windows_build` verde.
6. instalador maior que 1 MB e SHA256 calculado pelo job.

## Artefato

Nome esperado:

`AssistenciaTecnica-ArtiSys-Setup-1.0.0-Windows-x64.exe`

O instalador é armazenado nos artefatos do CircleCI em `assistencia-tecnica-v1.0.0`.

## Política de build

- branches de desenvolvimento: sem instalador;
- `main`: sem instalador da Assistência Técnica;
- `release/assistencia-v1.0.0`: um build final após quality e QA;
- publicação externa não é requisito do build;
- `electron-builder` roda com `--publish never`.

## Operação

- servidor local padrão: `0.0.0.0:3344`;
- acesso no PC: `http://127.0.0.1:3344`;
- acesso na LAN: `http://IP-DO-PC:3344`;
- banco: `data/assistencia-tecnica.sqlite`;
- uploads: `storage/assistencia-tecnica/uploads/`;
- eventos/auditoria: `data/assistencia-events.jsonl`.

## EventBus

Eventos emitidos pelo fluxo real incluem:

- `WORK_ORDER_CREATED`;
- `WORK_ORDER_STATUS_CHANGED`;
- `QUOTE_APPROVED`;
- `INVENTORY_MOVED`;
- `PAYMENT_REGISTERED`;
- `SALE_COMPLETED`;
- `SALE_CANCELLED`;
- `CASH_OPENED`;
- `CASH_MOVED`;
- `CASH_CLOSED`.

Integrações futuras devem ser registradas explicitamente no runtime de eventos. O core não depende de broker, webhook ou SaaS externo.
