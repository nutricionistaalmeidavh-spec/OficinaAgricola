# Leitor de código de barras — P0, P1 e P2

## Escopo entregue nesta branch

- **P0:** integrações mapeadas em `public/app-operations.js` (estoque), `public/app-assistencia.js` (vendas) e `public/paged-lookups.js` (pesquisa paginada). Uma peça usa `id` interno, `sku` canônico e saldo calculado por movimentos. O leitor não grava SKU, não altera banco e não modifica regras de venda, caixa, fiscal ou inventário.
- **P1:** leitor USB ou Bluetooth operando como teclado (keyboard wedge). Colocar o foco no campo “Escaneie ou digite o código” e escanear; o Enter final dispara busca exata do SKU. Suporte também a digitação manual. Leitura repetida imediatamente é ignorada; uma leitura posterior volta a funcionar. Não há captura global de teclado.
- **P2:** botão “Usar câmera”, pedido de permissão só após ação explícita, preferência pela câmera traseira, detecção de EAN-8, EAN-13, Code 128, Code 39 e UPC-A, botão para parar, liberação dos tracks, estados de falha e fallback manual. Usa a `BarcodeDetector` nativa quando disponível e, caso contrário, **Quagga2 MIT local**, já distribuído em `public/vendor/quagga.min.js`. Nenhum CDN, API externa ou licença paga. O cache do service worker inclui os ativos do scanner.

## Contrato e comportamento

1. Uma leitura encontra a peça **somente quando o código for igual ao SKU** já cadastrado. Vinculação de um GTIN/EAN separado do SKU é trabalho do P3; não afirmar que esse vínculo existe agora.
2. No estoque, a peça identificada é apresentada no status, com saldo; nenhum movimento é gravado.
3. Na nova venda com caixa aberto, a leitura seleciona a peça canônica no rascunho e atualiza a prévia do preço. A venda **somente é gravada ao clicar Concluir venda**, com confirmação do backend e idempotência existente.
4. A câmera analisa quadros localmente no dispositivo; quadros não são enviados a terceiros nem persistidos.
5. Uma empresa/unidade ativa continua determinando o escopo via API autenticada existente; não há cache de produtos entre unidades.
6. Câmera exige origem segura (`https://` ou `localhost`); abrir pelo IP de LAN em `http://` no celular não libera getUserMedia nos navegadores usuais. O produto deve fornecer HTTPS self-hosted para acesso remoto ao servidor.
7. Falhas deixam o campo manual disponível. Fechar o painel ou navegar interrompe a detecção e libera a câmera; operação pendente de consulta não cria lançamentos.

## Testes e critérios de aceite

- `node --test tests/barcode-scanner.test.js`
- `npm run lint && npm test && npm run build`
- Teste manual: USB e Bluetooth (modo teclado), Android e iOS em HTTPS, permissão negada, câmera indisponível, código não cadastrado, código parcial, alteração de unidade, fechamento de modal, leitura repetida e cálculo da prévia da venda.
- Não alterar secrets, configurações fiscais, autenticação ou lançamentos canônicos.

## Licença de terceiro

Quagga2 (biblioteca de leitura por câmera), MIT:
https://github.com/ericblade/quagga2
Licença preservada em `public/vendor/LICENSE-quagga2`.

## Fora do escopo P0–P2

Cadastro de múltiplos GTINs/códigos por peça, índice exclusivo e migração por unidade (P3); leitura para movimentação e consumo em OS (P4); UX de leitura contínua para carrinhos (P5).
