# ArtiSys Assistência Técnica

Versão separada do sistema de oficina, mantida no mesmo repositório sem substituir nem alterar a aplicação Oficina Agrícola existente.

## Isolamento

- aplicação: `apps/assistencia-tecnica/`;
- porta padrão: `3344`;
- banco local: `data/assistencia-tecnica.sqlite`;
- anexos: `storage/assistencia-tecnica/uploads/`;
- eventos/auditoria: `data/assistencia-events.jsonl`;
- Electron: `%LOCALAPPDATA%/ArtiSys/AssistenciaTecnica`;
- appId: `com.artisys.assistenciatecnica`;
- instalador e atalho próprios.

O sistema original continua na raiz do repositório e não depende desta aplicação.

## Princípios

- core R$ 0;
- self-hosted;
- funcionamento local/offline;
- SQLite local;
- nenhuma API ou SaaS pago obrigatório;
- serviços pagos, se adicionados futuramente, devem permanecer opcionais.

## Entregas 00–08

### 00 — Proteção

A versão estável anterior foi preservada em branch de backup antes da criação desta edição. O desenvolvimento ocorre em branch separada.

### 01 — Estrutura isolada

Aplicação independente dentro do mesmo repositório, com banco, configuração, porta, identidade Electron/PWA e instalador próprios.

### 02 — Cadastros

Clientes, equipamentos, técnicos, peças e catálogo de serviços com preço padrão e tempo estimado.

### 03 — Ordens de serviço

Criação, edição, consulta, histórico e fluxo auditável de status da entrada até a entrega.

### 04 — Execução técnica

Diagnóstico, checklists, fotos/anexos, peças consumidas, observações e acompanhamento técnico vinculados à OS.

### 05 — Orçamentos

Itens de peça, mão de obra e terceiros, desconto, validade, aprovação/reprovação e conversão do fluxo para execução.

### 06 — Estoque

Entradas, saídas, ajustes, consumo por OS, alerta de mínimo e baixa automática de peças em vendas de balcão. Cancelamento de venda estorna o estoque de forma auditável.

### 07 — Caixa e vendas

Venda de peças e serviços, cliente opcional, desconto, formas de pagamento, abertura/fechamento de caixa, suprimento, sangria, ajuste e estorno.

### 08 — Documentos

OS, orçamento, entrega e recibo imprimíveis/PDF, além da visão de relatórios operacionais e financeiros já integrada à aplicação isolada.

## Entrega 10 — Local / Offline

A aplicação funciona sem internet externa, com o computador principal atuando como servidor local.

- `HOST=0.0.0.0` permite acesso pela rede local;
- porta padrão `3344`;
- banco SQLite e anexos permanecem somente no computador servidor;
- tablet e celular acessam `http://IP-DO-COMPUTADOR:3344` enquanto estiverem na mesma rede;
- a interface mostra o estado **Servidor local disponível / indisponível**;
- erros de conexão informam claramente quando o computador servidor não está acessível;
- o shell PWA possui cache local para ambientes onde Service Worker é permitido;
- nenhuma API externa é necessária para o funcionamento principal.

### Observação sobre PWA em tablet/celular

O acesso web pela rede local funciona por HTTP sem internet. Entretanto, navegadores modernos normalmente exigem HTTPS para instalar/ativar Service Worker fora de `localhost`. Portanto, em `http://IP-DO-COMPUTADOR:3344` o sistema continua utilizável no navegador enquanto o servidor local estiver ligado, mas a instalação PWA/offline do shell pode ser bloqueada pelo próprio navegador. Não foi introduzido certificado externo nem serviço pago para contornar essa restrição.

## Entrega 11 — EventBus e integrações

O EventBus agora participa do fluxo real da aplicação. Mutações concluídas com sucesso geram eventos de domínio para OS, mudança de status, aprovação de orçamento, estoque, recebimentos, venda e caixa.

- o arquivo `data/assistencia-events.jsonl` mantém auditoria local dos eventos;
- integrações adicionais são opt-in e recebem eventos por assinatura;
- falha de integração opcional não desfaz nem bloqueia a operação local já concluída;
- nenhum webhook, broker ou SaaS externo é necessário para o core.

## Entrega 12 — QA e regressão

A edição Assistência Técnica possui gate próprio de qualidade e QA visual no CircleCI.

- `assistencia_quality`: lint, testes, build e E2E;
- `assistencia-qa-desktop`: fluxo visual em Chromium desktop;
- `assistencia-qa-mobile`: fluxo visual em viewport mobile;
- seed e servidor usam a mesma pasta `.qa/`;
- branches técnicas da Assistência não executam o QA da aplicação raiz, evitando gasto duplicado.

## Entrega 13 — Build final

A versão final é `1.0.0` e o instalador é gerado apenas na branch dedicada `release/assistencia-v1.0.0`, depois de quality + QA desktop + QA mobile.

Artefato esperado:

`AssistenciaTecnica-ArtiSys-Setup-1.0.0-Windows-x64.exe`

O build usa `--publish never`; publicação externa não é requisito para considerar o instalador válido.

## Entrega 14 — Entrega

A entrega final consiste em:

- código mergeado em `main`;
- release branch criada a partir da `main` validada;
- gates da Assistência verdes;
- instalador Windows x64 armazenado como artefato do CircleCI;
- SHA256 exibido no job de build;
- documentação de operação local, QA e release atualizada.

Detalhes adicionais estão em `RELEASE.md`.

## Execução local

```bash
cd apps/assistencia-tecnica
cp .env.example .env
npm run db:migrate
npm run db:seed
npm start
```

No próprio computador, abra `http://127.0.0.1:3344`.

Para uso em tablet/celular:

1. mantenha `HOST=0.0.0.0`;
2. conecte os dispositivos à mesma rede do computador;
3. descubra o IPv4 local do computador, por exemplo `192.168.1.20`;
4. abra `http://192.168.1.20:3344` no dispositivo;
5. caso o Windows solicite, permita o acesso do aplicativo à rede privada/firewall.

O terminal também lista os endereços LAN encontrados ao iniciar o servidor.

## Testes

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Os testes finais cobrem rede local/offline, EventBus integrado, isolamento de integrações opcionais, venda/caixa/estoque, fluxo crítico HTTP e os gates de release.
