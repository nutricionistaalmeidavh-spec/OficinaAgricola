# UX de vendas, OS e fiscal — P0 a P2

## Objetivo
Guiar o operador sem esconder recursos. Todas as ações existentes continuam visíveis nos módulos originais; botões em destaque são atalhos para o mesmo fluxo, não novos livros financeiros ou caminhos alternativos de estado.

## P0 · Vendas e ordens de serviço
- Venda de balcão: caixa aberto, seleção de itens e serviços, prévia destacada e conferência de pagamentos Pix/cartão/transferência antes da confirmação manual.
- OS: faixa superior com a ação sugerida conforme o estado (diagnóstico → orçamento → aprovação → execução → serviço pronto → entrega), sem retirar botões de status, orçamento, peças, fotos, checklists, documentos ou histórico.
- Recebimento: botão principal **Receber pagamento** com três opções claras (recebimento já conferido, gerar cobrança, parcelamento); as mesmas opções permanecem acessíveis diretamente na seção financeira.
- Registro manual de recebimento de OS requer confirmação do operador. Gerar Pix estático nunca baixa o pagamento; TEF/PSP seguem opcionais e só confirmam com provedor autenticado.
- OS pronta com saldo pendente destaca o recebimento primeiro sem bloquear a entrega explicitamente permitida pelo domínio.
- Detalhes da venda mostram atalho para preparar documento fiscal, conforme permissão.

## P1 · Fiscal e estornos
- Fiscal: **Preparar documento** e **Configuração e testes** aparecem em grupos nomeados, com **Dados fiscais**, **Perfis tributários**, **Certificado A1**, **Token A3** e **Testar SEFAZ** sempre visíveis para administradores.
- Faixa **Próximo passo** orienta configuração/homologação/preparação. Não libera produção, não dispensa revisão tributária e não altera os gates do servidor.
- Estornos de peças e recebimentos da OS usam formulários de confirmação com motivo obrigatório; o histórico e o comportamento do backend permanecem inalterados.

## P2 · Acessibilidade e descoberta
- Layout responsivo com botões de pelo menos 44 px em áreas novas, labels explícitas e foco nativo.
- Textos distinguem cobrança pendente de recebimento confirmado, reduzindo baixa financeira por engano.
- Os componentes de orientação não colapsam/ocultam operações em menus; mobile organiza botões visíveis em uma coluna quando necessário.

## Regressão
- Contrato estático: `tests/ux-sales-os-discoverability.test.js`.
- Jornada navegador de OS: `scripts/qa-cliente-os.mjs` cobre confirmação manual e modais de estorno.
- Jornada PostgreSQL navegador: `scripts/qa-postgres-journey.mjs` cobre seleção Pix com conferência explícita, prévia e alteração concorrente de preço.

## Segurança e limites
- Não altera tabelas, migrations, certificados, tokens, secrets, permissões ou regra fiscal.
- O sistema permanece R$ 0, self-hosted e open source no núcleo; provedores Pix/TEF externos seguem opt-in.
- Não publicar nem realizar merge antes de CI e QA desktop/mobile verdes.
