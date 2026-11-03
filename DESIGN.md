---
version: alpha
name: ArtiSys Oficina
description: Painel de operação local para oficinas, com verde oliva e leitura direta.
colors:
  primary: "#365314"
  secondary: "#4d6b1f"
  accent: "#b45309"
  background: "#f6f8f5"
  surface: "#ffffff"
  foreground: "#20251c"
  muted: "#52604c"
typography:
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  utility:
    fontFamily: 'ui-monospace, Consolas, monospace'
rounded:
  md: "10px"
  lg: "14px"
spacing:
  page: "26px"
  pageMobile: "14px"
components:
  dialog: {}
  navigation: {}
---

# ArtiSys Oficina

## Overview

Interface de produto para atendimento e técnicos de oficinas mecânicas, assistência e manutenção agrícola. Português do Brasil, uso frequente no computador e no celular. A assinatura é o verde oliva já adotado pela marca, com superfícies claras. Priorizar identificação da OS, cliente, equipamento e próxima ação. Evitar efeitos decorativos, roxo e novas fontes remotas. Core gratuito, open source, self-hosted; nenhum serviço externo necessário para renderizar ou operar.

## Colors

Modelo B: `public/theme-lote-a.css` é a autoridade das cores de marca. As entradas acima espelham seus tokens; `public/ui-stage7.css` adapta `--green`, `--green-2`, `--green-3`, `--ink`, `--muted`, `--line`, `--bg`, `--card` e `--shadow` para aliases `--oa-*`, sem copiar os valores. `styles.css` mantém estrutura e cores semânticas de erro/aviso; não redefine a paleta. Âmbar indica pendência com rótulo textual, nunca somente cor.

## Typography

A família de corpo permanece em `public/styles.css`; Inter é opcional, com fallback de sistema e sem download obrigatório. Cards de OS usam título de 14px e descrição de 13px; menu mobile 12px. Títulos e valores têm maior peso. Valores monetários preservam tabular-nums. Não reduzir texto para acomodar rótulos: permitir quebra ou rolagem.

## Layout

Sidebar de 252px no desktop. Até 840px, navegação inferior com itens que não encolhem (116px), rótulos em duas linhas e rolagem horizontal visível. A busca permanece no cabeçalho em uma segunda linha. `local-runtime.css` mantém o estado do servidor no fluxo do documento entre cabeçalho e conteúdo; nunca sobre o perfil ou formulários. O conteúdo preserva rolagem natural, com tabelas e quadros rolando internamente.

## Elevation & Depth

Sombra leve nos cards; modal com backdrop. Camadas canônicas em `ui-stage7.css`: cabeçalho, navegação, diálogo, toast. Nenhum indicador de conexão flutuante.

## Shapes

Controles de 9–10px e superfícies de 12–14px. Não adicionar uma nova linguagem de arredondamento por tela.

## Components

| Papel | Dono | Consumidores |
|---|---|---|
| Paleta de marca | `theme-lote-a.css` | Botões, aliases `--oa-*`, sidebar |
| Scrollbar | `ui-stage7.css`, tokens `--scroll-*` em `theme-lote-a.css` | Todo overflow próprio |
| Navegação e foco | `app-core.js`, `index.html`, `ui-stage7.css` | Todas as páginas |
| Modal | `showModal`, `requestCloseModal`, `closeModal` em `app-core.js` | Cadastro, edição, OS, histórico e busca |
| Estado do servidor | `local-runtime.js` e `local-runtime.css` | Shell |

## Do's and Don'ts

Preservar nós, foco, rascunhos e scroll após atualizações pontuais, conforme ADR-0002. Usar botões reais para cards acionáveis. Manter foco visível e respeitar reduced-motion. Não esconder scrollbars, busca mobile ou textos longos. Não alterar autenticação, saldos ou transições como consequência de ajustes visuais.

Drift resolvido nesta entrega: os verdes independentes de Stage7 tornaram-se aliases da marca; navegação deixou de encolher os rótulos; indicador deixou de flutuar sobre conteúdo. Evidência: `scripts/qa-ui-contract.mjs`, consumido pelo workflow de QA desktop/mobile.
