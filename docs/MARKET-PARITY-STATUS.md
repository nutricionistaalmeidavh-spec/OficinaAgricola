# ArtiSys Oficina — paridade competitiva (P0–P3)

Branch de trabalho: `feat/p0-p2-market-parity-20261103`. Não fazer merge/publicação sem CI e QA completos.

## Entregas desta branch
- P1: autorização de orçamento via token criptograficamente aleatório (256 bits), hash SHA-256 no SQLite, validade de 1 a 168 horas, revogação do link anterior, bloqueio por mudança de orçamento e decisão de uso único. Portal `/approval.html` sem login e sem dados internos. Compartilhamento manual pelo operador.
- P2: agenda CRM local com tarefas vinculadas a clientes, veículos e OS, conclusão registrada, lembretes preventivos gerados de forma idempotente, consulta de placas **somente** em cadastros locais.
- P3: cadastro de frotas com verificação de propriedade dos veículos, unidades para atribuição de OS e relatório agregado por unidade; referências técnicas de peças declaradas, sem afirmar homologação OEM.
- Novos fluxos acessíveis em **CRM e Frotas**, desktop e mobile.
- Testes de regressão e HTTP para links de aprovação, CRM, placa, unidades, frotas, referências e RBAC.

## Limites que não podem ser confundidos com funcionalidades concluídas
- **Fiscal P0:** motor ACBr e empacotamento preexistentes permanecem sujeitos a certificado, parâmetros tributários e homologação SEFAZ/municipal real. Não emitir em produção automaticamente.
- **P2:** nenhuma consulta de placa nacional/DETRAN foi adicionada e nenhuma mensagem WhatsApp/e-mail é enviada automaticamente. O núcleo não depende de API externa.
- **P3 multioficinas:** `unit_id` classifica OS e permite relatórios, mas **não** isola clientes, estoque, financeiro, usuários, arquivos ou documentos fiscais entre unidades. Não usar como tenancy segura. Até isolamento verdadeiro, unidades devem operar sob uma mesma administração/dados compartilhados, ou executar instâncias independentes com bancos separados.
- **Diagnóstico físico:** OBD-II/J1939/J2534 continuam exigindo drivers e hardware compatível para validação real. Testes simulados não homologam veículos.
- **Link externo:** cliente precisa acessar a instância por HTTPS seguro para utilização fora da rede local; nenhuma hospedagem paga é mandatória.

## Critérios para encerrar toda a iniciativa P0–P3
CI completo (lint, unidade, integração, build, E2E), QA desktop/mobile, testes Windows limpo e ACBr, revisão LGPD/segurança de tokens e dados, homologação fiscal real, diagnóstico em hardware real e isolamento multioficinas ou estratégia de instâncias separadas validada.

Sem edição de secrets, sem assinatura ou serviços pagos obrigatórios, sem merge e sem publicação nesta branch.
