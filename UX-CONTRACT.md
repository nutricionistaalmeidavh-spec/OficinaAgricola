# Contrato de interação — ArtiSys Oficina

Referências autoritativas: [ADR-0001](docs/architecture/0001-zero-dependency-core.md), [ADR-0002](docs/architecture/0002-canonicalidade-e-ui-estavel.md), [fila e recuperação](docs/COMMAND-QUEUE-RECOVERY.md). Identidade visual: [DESIGN.md](DESIGN.md). Este documento não altera regras de pagamento, permissões, autenticação ou transição da OS.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Scrollbar | `public/ui-stage7.css` | DESIGN.md | tabelas, quadro e menu com overflow | `scripts/qa-ui-contract.mjs` |
| Toast | `toast` em `public/app-core.js` | texto da operação + ADR-0002 | sucesso / erro, live region | QA existente + inspeção |
| CRUD | `navigate`, `refreshCurrentPage`, `showModal` | ADR-0002 e serviços canônicos | criar / editar / consultar | `scripts/qa-demo.mjs` |
| Select/Listbox | HTML select existente | contratos dos formulários | nativo; popup do SO aceito | QA de cadastro existente |
| Date | input date existente + Intl pt-BR | contratos dos serviços | nativo; popup do SO aceito | QA de revisão e garantia |
| Form | formulários existentes + `showModal` | ADR-0002 | submissão idempotente, preservar rascunho | QA de falha e de fila |

## Navegação e busca

Menu mobile conserva todas as entradas existentes, por rolagem horizontal visível. Sem novo roteador ou cópia do cadastro. O item atual tem `aria-current=page`. Busca global explicitamente enviada por Enter ou botão Buscar; não é autocomplete. Limpar cancela a aceitação de resultados antigos e devolve foco ao input. IME não dispara buscas durante composição. A consulta é transitória e não vai à URL por conter dados pessoais. Campos e rótulos usam pt-BR.

## Modal compartilhado

Uma única superfície, sem diálogos aninhados. Nome por `aria-labelledby`, foco inicial na superfície, Tab/Shift+Tab contidos, fundo inert e scroll do documento bloqueado. Ao fechar, restaurar foco ao acionador conectado ou à navegação atual. Sucessores mantêm o contexto de origem. Atualização da mesma entidade conserva o DOM do formulário.

Escape, X e backdrop passam por `requestCloseModal`. Formulários alterados exigem confirmação app-owned, com “Continuar editando” como foco inicial. Durante submissão, aguardar a confirmação; bloquear duplicações. Falha confirmada mantém formulário e erro inline; conclusão incerta continua com a fila durável estabelecida pelo ADR-0002. Sucesso usa o fluxo canônico do módulo. Altura do modal acompanha visualViewport quando disponível.

## Limites e verificação

Esta entrega cobre shell, busca e modal compartilhado. Validação de campos legados permanece existente; não significa homologação completa de WCAG. Paginação e estados de todos os módulos, validação de todos os campos, dispositivos físicos e leitores de tela exigem cobertura própria. O QA verifica geometrias em 320/390/840/1024/1440px, foco, navegação por teclado, busca vazia, falha com rascunho e descarte, além dos fluxos canônicos anteriores.
