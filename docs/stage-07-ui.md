# Etapa 07 — Interface definitiva do Oficina Agro

## Objetivo

Aplicar a identidade visual definitiva do Oficina Agro sobre o core operacional das Etapas 00–06 sem mover regra de negócio para o navegador e sem alterar contratos existentes de OS, estoque, financeiro, agenda ou cadastros.

## Direção visual

- sidebar verde escura e navegação compacta;
- superfície principal clara, com cards discretos e baixa densidade visual;
- dashboard com KPIs, pipeline de Ordens de Serviço, agenda próxima e estoque crítico;
- busca global de clientes, máquinas e OS usando apenas APIs existentes;
- relatórios operacionais derivados dos endpoints atuais, sem BI externo;
- desktop, tablet e celular com todas as áreas acessíveis;
- sem glassmorphism e sem dependência visual paga.

## Isolamento

`public/ui-stage7.css` contém somente a camada visual. `public/app-stage7.js` compõe dados recebidos da API para dashboard, busca e relatórios, sem SQL e sem persistência própria. As operações continuam nos módulos de domínio e serviços do servidor.

## Mobile/LAN

A navegação inferior é horizontal e rolável no celular para não ocultar Financeiro, Relatórios, Técnicos ou Configurações. O mesmo frontend é usado no acesso local via LAN/PWA.

## QA

A integração do `@artisys/qa` fica em `qa/` e no workflow opcional `artisys-qa-stage7.yml`. O fluxo padrão valida o shell público. O fluxo autenticado usa credenciais fornecidas por variáveis de ambiente e a regressão visual só roda quando explicitamente habilitada.

## Integração

Esta etapa deve permanecer na branch `feat/etapa-07-ui-artisys-qa` até decisão explícita de integração. Nenhum merge em `main` faz parte desta entrega.
