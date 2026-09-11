# ADR 0001 — Núcleo self-hosted sem dependências de runtime

**Status:** Aceito para a V1 00–06  
**Data:** 2026-09-11

## Contexto

A especificação sugeria React/Vite, Fastify, Drizzle e SQLite. O requisito prioritário do produto, porém, é manter o núcleo R$ 0, self-hosted, operável sem internet e sem dependência silenciosa de serviço externo. Durante a implementação, o ambiente disponível não possuía acesso confiável ao registro npm para instalar dependências e o repositório começou vazio.

## Decisão

A V1 usa somente recursos distribuídos com Node.js e APIs do navegador:

- `node:http` para servidor e REST;
- `node:sqlite` para persistência SQLite;
- `node:crypto` (`scrypt`, random bytes e SHA-256) para autenticação local;
- HTML, CSS e JavaScript nativos para a aplicação responsiva;
- `node:test` para domínio, integração e fluxo crítico HTTP.

A organização permanece modular: domínio, banco, autenticação, serviços por contexto e interface são separados. Isso preserva a possibilidade de trocar o frontend por React ou o transporte por Fastify sem reescrever regras de negócio.

## Consequências

### Positivas

- `npm ci` não baixa dependências de runtime de terceiros;
- instalação e operação podem ser totalmente offline;
- superfície de supply-chain reduzida;
- build simples e portátil;
- não existe custo recorrente obrigatório.

### Trade-offs

- em Node 22, `node:sqlite` ainda pode emitir `ExperimentalWarning`;
- a interface não usa ecossistema de componentes React nesta fase;
- validação visual Playwright continua opcional, enquanto o gate obrigatório usa testes nativos e fluxo crítico HTTP.

## Limite da decisão

Esta ADR não proíbe dependências open source futuras. Uma dependência poderá ser adotada quando trouxer benefício operacional claro, desde que não introduza serviço pago obrigatório e tenha validação de build/teste antes de entrar no release.
