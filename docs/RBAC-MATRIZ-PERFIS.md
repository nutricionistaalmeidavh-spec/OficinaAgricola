# Matriz de permissões — ArtiSys Oficina (PostgreSQL)

Esta matriz vale para o **perfil do usuário na unidade selecionada**. O perfil
global da conta não substitui o vínculo da unidade. O servidor verifica cada
requisição; ocultar botões na interface não constitui autorização.

| Módulo visível | Administrador | Atendimento | Técnico | Financeiro |
| --- | :---: | :---: | :---: | :---: |
| Visão geral operacional | Sim | Sim | Sim | Sim |
| Ordens de serviço e orçamentos (consulta) | Sim | Sim | Sim | Sim |
| Agenda (consulta) | Sim | Sim | Sim | Sim |
| Clientes, equipamentos, serviços, peças e estoque (consulta) | Sim | Sim | Sim | Sim |
| CRM, frotas e referências (consulta) | Sim | Sim | Sim | Sim |
| Relatórios operacionais (sem demonstrativo financeiro para não financeiros) | Sim | Sim | Sim | Sim |
| Técnicos (consulta) | Sim | Sim | Sim | Sim |
| Vendas e caixa | Sim | Sim | Não | Sim |
| Financeiro e recebimentos de OS | Sim | Não | Não | Sim |
| Fiscal | Sim | Não | Não | Sim |
| Configurações, usuários e perfis | Sim | Não | Não | Não |

## Ações críticas

| Operação | Perfis permitidos |
| --- | --- |
| Criar/editar clientes, equipamentos e peças; movimentar estoque | Administrador, Atendimento |
| Criar OS e gerenciar orçamentos | Administrador, Atendimento |
| Atualizar execução de OS, status, peças aplicadas, checklist, anexos e agenda | Administrador, Atendimento, Técnico |
| Vender e abrir/fechar caixa | Administrador, Atendimento, Financeiro |
| Cancelar venda, registrar/estornar recebimentos e gerenciar despesas | Administrador, Financeiro |
| Consultar fiscal e enviar documentos configurados | Administrador, Financeiro |
| Alterar configuração e realizar cancelamentos/revisões fiscais privilegiados | Administrador |
| Criar administradores, criar usuários, modificar vínculos, gerenciar unidades | Administrador com vínculo autorizado |

Observações:

- O catálogo de peças, valores de venda e orçamentos de OS ainda são
  **dados operacionais** visíveis a todos os quatro perfis. Não confundir com
  os livros de recebimentos, despesas ou resumo financeiro.
- O painel de financeiro **dentro da OS** só é solicitado e exibido para
  Administrador e Financeiro; os endpoints de pagamento e recibos requerem
  esses mesmos perfis.
- Os controles de criação/edição que aparecem no frontend devem refletir a
  ação permitida. O backend continua rejeitando uma tentativa manual com HTTP
  403, mesmo se a requisição for feita fora da interface.
- Nenhum serviço pago é necessário: núcleo local com PostgreSQL e arquivos
  servidos no próprio aplicativo.
- A lista de rotas legado→PostgreSQL é mantida em
  `src/platform/native-api-route-map.js`; a verificação do serviço nativo
  usa **a mesma matriz** para as rotas mapeadas, evitando decisões divergentes.
  Rotas privadas não mapeadas preservam seus próprios controles de serviço.
- A alteração de função em outra unidade exige novo contexto autenticado;
  trocas de unidade recarregam a interface.
- Autenticação, vínculo da unidade e autorização são condições cumulativas.

## Regressões obrigatórias

`tests/rbac-route-parity.test.js` cobre divergências entre gateway e rota
nativa. `tests/rbac-gateway-roles.test.js` prova o bloqueio no gateway por
perfil/vínculo. `tests/rbac-ui-roles.test.js` valida o menu e a omissão de
consultas ao livro financeiro por funcionários não financeiros. A bateria
completa continua sendo `npm run ci`, com backend PostgreSQL de integração
configurado quando exigido pelos testes de instalação.
