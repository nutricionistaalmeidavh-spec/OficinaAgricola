# P6 — QA e homologação do leitor de código de barras

Escopo desta matriz: **P0–P2 da PR #55** (captura USB/Bluetooth keyboard-wedge, digitação e câmera). As funções P3–P5 ainda não estão completas e não devem ser interpretadas como homologadas.

## Portão automático executado pela CI

- `npm run lint`: verificação de sintaxe de JS/MJS.
- `npm test`: inclui `tests/barcode-scanner.test.js` e `tests/barcode-p6.test.js`; o segundo cobre tentativa após erro, leitura enquanto busca pendente, permissão tardia, fechamento do modal, decoder Quagga2 sem CDN, câmera inacessível, cancelamento de leitura, isolamento da pesquisa por unidade, código inválido e integração sem movimentações.
- `npm run build`: empacota a UI e o decoder open source local.
- `npm run test:e2e`: protege a jornada existente; não substitui leitor/câmera física.
- QA Etapa 07, paridade PostgreSQL/D1, D1 local e instalador Windows: verificações da mesma árvore de código conforme execução no GitHub Actions.
- **Aprovação automática exige conclusão `success` dos workflows obrigatórios para o SHA exato do candidato.** Nenhuma execução antiga vale para um commit novo.

## Homologação manual — pendente até registrar evidência real

| Caso | Preparação | Ação | Resultado de aprovação |
| --- | --- | --- | --- |
| USB | Leitor HID, sufixo Enter, SKU conhecido | Focar campo no Estoque e escanear | Peça e saldo corretos; nenhuma movimentação |
| Bluetooth | Leitor pareado em modo teclado | Ler mesmo SKU após focar | Resultado idêntico ao USB |
| Teclado | SKU com zero inicial e código desconhecido | Digitar e apertar Enter | Preserva zeros; não encontra por aproximação |
| EAN-8/EAN-13 | SKU cadastrado igual ao conteúdo do código | Escanear etiqueta impressa | Produto exato, sem dependência de GTIN distinto |
| Code 128 / Code 39 | SKU de exemplo na etiqueta | Escanear | Não muda preço ou estoque |
| Android | Navegador compatível, página HTTPS | Abrir câmera e autorizar | Câmera traseira preferida e leitura correta |
| iOS | Safari compatível, página HTTPS | Abrir câmera e autorizar | Leitura e liberação da câmera ao fechar |
| Permissão negada | Restringir câmera no navegador | Selecionar “Usar câmera” | Erro explicativo e entrada manual intacta |
| Sem HTTPS | Abrir página via IP LAN em HTTP | Selecionar câmera | Explica necessidade de HTTPS; leitor USB continua disponível |
| Concorrência | Caixa aberto e produto cadastrado | Ler SKU e fechar modal durante busca | Nenhum item aplicado a outro modal |
| Venda | Caixa aberto com preço/estoque conhecido | Ler SKU e não concluir venda | Apenas prévia; nenhum débito nem movimento |
| Estoque insuficiente | Venda de peça sem quantidade disponível | Confirmar venda via fluxo existente | Backend rejeita sem criar saldo negativo |
| Multiempresa | Duas unidades com SKU igual e produtos/saldos distintos | Trocar unidade e reler | Nunca reutilizar dados da outra unidade |
| Acessibilidade | Teclado e leitor de tela | Operar campo, câmera e mensagens | Foco acessível, controles rotulados, status anunciado |
| Responsividade | 360px, 390px, 768px e desktop | Abrir Estoque e Nova venda | Controles legíveis sem sobreposição |
| Desconexão | Desligar servidor durante a consulta | Ler, restaurar rede e repetir | Erro visível; nova tentativa sem bloqueio; rascunho intacto |

Para cada caso manual, registrar: **aprovado/reprovado/não executado; data; testador; leitor (marca, modo USB/Bluetooth e sufixo); dispositivo; sistema operacional; navegador/versão; evidência e eventual issue.** Não marcar dispositivo como homologado só porque um mock automatizado passou.

## Escopo de release e limitações declaradas

- O código lido deve coincidir com o **SKU** cadastrado. Um campo de GTIN/EAN separado e sua unicidade pertencem ao P3.
- Leitura no Estoque não faz entrada/saída. Fluxos de inventário e OS por scanner pertencem ao P4.
- Em vendas, a leitura seleciona item na prévia, preservando a finalização explícita. Leitura contínua de carrinho e atalhos pertencem ao P5.
- Navegadores móveis só autorizam `getUserMedia` em contextos seguros (normalmente HTTPS ou localhost). A solução self-hosted pode usar proxy reverso/TLS gratuito; nenhum serviço pago é obrigatório.
- A biblioteca Quagga2 está embarcada e sua licença MIT está em `public/vendor/LICENSE-quagga2`.
- **Sem merge na main por P6 sozinho**: requer todas as verificações necessárias aprovadas e aceite explícito do escopo pendente, principalmente os testes reais de hardware.
