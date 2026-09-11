# OficinaAgro — Fundação 08

## Objetivo

Adicionar infraestrutura transversal de baixo risco às etapas em andamento sem alterar regras de negócio dos módulos 00–07.

## Restrições

- Core R$ 0, self-hosted e open source.
- Nenhum SaaS, Redis, broker, banco ou serviço pago obrigatório.
- Sem compra inteligente, fiscal ou notificações internas.
- Nenhuma mudança de comportamento em OS, estoque, financeiro ou cadastros nesta etapa.
- Integração incremental e reversível.

## Componentes

### EventBus

EventBus em memória, assíncrono, com contratos de evento validados e suporte a assinantes por tipo e curinga `*`. Nesta etapa ele não altera regras existentes: fica pronto para consumidores futuros.

### Auditoria

Consumidor do EventBus que grava eventos em JSONL local, com `eventId`, tipo, data/hora, ator, correlação e payload. O arquivo é append-only e não exige migration de banco.

### Backup/restauração

Serviço local que copia banco e anexos para uma pasta versionada, gera manifesto com SHA-256 e valida integridade antes da restauração. A captura do SQLite deve ser chamada somente após checkpoint/fechamento seguro do banco; o módulo não tenta copiar silenciosamente um banco ativo.

### Jobs locais

Fila em processo, FIFO, sem Redis, com registro explícito de handlers, execução sequencial padrão e `drain()` para testes/encerramento controlado.

### LAN / tablet / celular

Configuração de servidor com `HOST=0.0.0.0` por padrão, resolução de URLs IPv4 da rede local e ativos PWA. O service worker não intercepta `/api/` e usa estratégia network-first para evitar dados/API obsoletos.

## Integração segura

Nesta etapa os módulos ficam em `src/platform/`. Nenhuma função de `src/domain.js` será reescrita para publicar eventos. A única alteração na interface será a inclusão do manifesto PWA e do registrador de service worker no `index.html`.

## Critérios de aceite

1. EventBus publica, assina e desassina eventos.
2. Auditoria persiste evento localmente e pode ser lida novamente.
3. Backup cria manifesto verificável e restauração rejeita backup corrompido.
4. Job queue executa trabalhos FIFO e aguarda esvaziamento.
5. Configuração LAN usa `0.0.0.0` por padrão e lista endereços IPv4 locais.
6. Manifesto PWA e service worker estão presentes; `/api/` nunca é cacheado.
7. `npm run lint`, `npm test`, `npm run build` e `npm run test:e2e` ficam verdes antes de integração.
