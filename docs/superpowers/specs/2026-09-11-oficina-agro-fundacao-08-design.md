# OficinaAgro — Fundação 08

## Objetivo

Adicionar infraestrutura transversal de baixo risco às etapas em andamento sem alterar regras de negócio dos módulos 00–07.

## Restrições

- Core R$ 0, self-hosted e open source.
- Nenhum SaaS, Redis, broker, banco ou serviço pago obrigatório.
- Sem compra inteligente, fiscal ou notificações internas.
- Nenhuma mudança de regra em OS, estoque, financeiro ou cadastros nesta etapa.
- Integração incremental e reversível.

## Componentes

### EventBus
EventBus em memória e assíncrono, com contratos de evento em JSDoc, nomes canônicos e assinantes por tipo ou curinga `*`. Nesta etapa não altera as regras atuais: fica pronto para consumidores futuros.

### Auditoria
Consumidor opcional do EventBus que grava eventos em JSONL local append-only, com `eventId`, tipo, data/hora, ator, correlação e payload.

### Backup/restauração
Serviço local que copia banco e anexos para pasta versionada, gera manifesto SHA-256 e valida integridade antes de restaurar. O chamador deve garantir checkpoint/fechamento seguro do SQLite antes da captura.

### Jobs locais
Fila em processo, FIFO, sem Redis, com handlers explícitos e `drain()` para testes/encerramento controlado.

### LAN / tablet / celular
O launcher passa a usar `0.0.0.0` por padrão, mantendo possibilidade de sobrescrever `HOST`. O sistema continua centralizado no PC/servidor local e pode ser acessado por navegador de PC, tablet ou celular na mesma LAN/Wi-Fi, sem internet. Ativos PWA são incluídos sem cachear `/api/`.

> Observação: instalação completa como PWA via service worker depende de contexto seguro (HTTPS ou localhost) conforme o navegador. O acesso local via navegador em `http://IP-LOCAL:porta` continua independente disso.

## Integração segura

Os módulos ficam isolados em `src/platform/`. O domínio e os serviços existentes não são reescritos para publicar eventos nesta fase. O launcher `src/start.js` concentra a configuração LAN, e a interface recebe apenas manifesto/registro de PWA.

## Critérios de aceite

1. EventBus publica, assina e desassina eventos.
2. Auditoria persiste eventos e pode relê-los.
3. Backup cria manifesto verificável e restauração rejeita corrupção.
4. Job queue executa FIFO e aguarda esvaziamento.
5. Launcher usa `0.0.0.0` por padrão e lista URLs IPv4 LAN.
6. Manifesto/service worker existem e `/api/` não entra no cache.
7. Nenhuma dependência externa é adicionada.
