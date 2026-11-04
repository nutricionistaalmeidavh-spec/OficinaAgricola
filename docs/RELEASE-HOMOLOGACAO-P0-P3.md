# ArtiSys Oficina — homologação P0–P3 (sem multiempresa)

**Escopo:** aplicativo local-first, SQLite, Electron/Windows e Linux self-hosted. Nenhum serviço pago é obrigatório. A PR de multiempresa segue separada. Não publicar, fazer merge ou ativar emissão fiscal por existir um teste simulado aprovado.

## P0 · integridade, recuperação e distribuição

- Backup usa snapshot SQLite WAL-consistente, inventário de arquivos com SHA-256, rejeição de manifestos sem banco, paths de fuga, links simbólicos e arquivos extras. Antes da restauração, banco deve passar em `PRAGMA integrity_check` e `foreign_key_check`.
- Backup recente só é reutilizado após prova de restauração; arquivo corrompido é preservado para análise e novo snapshot é criado. Retenção remove apenas arquivos já verificados, sem apagar cópia suspeita.
- `npm run ci`, QA visual desktop/mobile e workflow `Windows · Instalador limpo` devem estar verdes **para o commit exato**. Atualização de dependências/Node e vulnerabilidades exigem verificação própria.
- Smoke Windows instala em VM limpa, cria administrador, abre sessão, registra cliente, reinicia instalador sobre a mesma instalação, confirma que usuário/dados permanecem e que fiscal continua desativado. **É reinstalação da mesma versão, não migração comprovada entre duas versões publicadas.**
- Antes de entregar executável, executar `powershell -File scripts/verify-installer.ps1 -Installer <arquivo.exe> -ExpectedSha256 <hash>`. Com certificado de assinatura válido, adicionar `-RequireSignature`; assinatura não é requisito do núcleo R$ 0.
- Atualização de versão anterior: executar matriz independente com instaladores antigo/novo, banco de cliente **cópia anonimizada**, migração, backup, rollback testado, anexos e operações pendentes. Não existe auto-update remoto habilitado por esta entrega.
- Simular queda de processo/SIGKILL em testes automatizados. **Queda física de energia/SSD danificado** exige prova manual em equipamento de laboratório, sem dados de cliente; nenhuma suíte reproduz isso integralmente.
- Nunca alterar banco do cliente sem backup comprovadamente restaurável e controle de versão do schema. Não regravar saldos históricos.

## P1 · fiscal (NF-e e NFS-e)

O adaptador ACBr local e DLLs Windows não representam homologação real. A emissão permanece desligada por padrão.

- Obter certificado e credenciamento do próprio emissor, regime e parâmetros tributários revisados pelo contador; não subir certificado, PIN, XML com CPF/CNPJ ou senhas ao Git.
- Em **HOMOLOGACAO**, enviar NF-e para SEFAZ e NFS-e para autoridade competente em município/provedor aderente; registrar somente referências pseudonimizadas de protocolo e hash em evidência privada.
- Provar autorização, rejeição, timeout com consulta, idempotência, XML autorizado, cancelamento e retentativas sem cobrança/estoque duplicado; verificar via portal oficial da autoridade.
- Só depois fazer piloto **separado**, explicitamente aprovado, em produção. Não marcar documento de homologação como documento fiscal de produção.
- `node scripts/release-evidence.mjs docs/release-evidence.example.json fiscal` bloqueia evidências ausentes/simuladas; o arquivo de exemplo não passa.

## P1 · diagnóstico em veículo real

- Selecionar adaptador real ELM327/OBDLink ou J2534 e confirmar fabricante, DLL e protocolo; em agrícola/comercial, selecionar interface CAN e J1939 suportados.
- Com veículo de teste autorizado, capturar sessão real, DTCs, leituras e laudo PDF; conferir que o laudo não mostra `SIMULATED`.
- Testar falha de cabo, ECU desligada, driver ausente e incompatibilidade: **não** apresentar dados simulados como reais. Não apagar falhas nem programar ECU.
- Registrar identificação não pessoal do veículo, modelo de adaptador, versão do driver, resultado e artefato supervisionado (sem VIN/placa).

## P1 · impressão física

- Selecionar impressora USB, rede ou térmica instalada no Windows; verificar spooler, A4 (OS/orçamento) e 80 mm se oferecer cupom.
- Imprimir documento real de teste pelo fluxo de visualização/PDF e confirmar legibilidade, margem, corte, acentuação, segunda via, falta de papel, dispositivo offline e recuperação de fila.
- Registrar referência do job de spool e confirmação visual. **Geração de PDF e smoke de navegador não homologam impressora física.**
- Nenhuma impressora ou driver proprietário é obrigatório para o sistema rodar.

## P2 · seleção paginada e desempenho

- Formulários principais devem usar `/api/customers/page`, `/api/machines/page` e `/api/parts/page` com limite e busca remota, sem carregar tabelas enormes na abertura.
- Seleções preservam IDs canônicos e guardam opção previamente escolhida. Ao trocar cliente, equipamento anterior deve ser limpo.
- Benchmarks disponíveis: `npm run db:benchmark -- --size=1000`, `10000` e `100000` em ambiente isolado. Validar p50/p95 e memória no hardware alvo, sem limiar universal arbitrário.
- Nesta branch, formulários de abertura, edição e duplicação de OS, cadastro de equipamento, agenda e vendas de balcão passaram a consultar clientes, veículos, peças e OS por busca paginada; a venda preserva saldo/preço e a chave idempotente original.
- Rotas integrais antigas continuam disponíveis por compatibilidade. Histórico de alterações, alguns formulários secundários e catálogo de serviços ainda exigem auditoria e eventual paginação antes de afirmar cobertura integral da interface.

## P3 · gate de aceite e distribuição

1. Registrar o SHA de commit da versão, evidências CI, QA e Windows, backup/restauração e teste manual de desastre.
2. Para vender funcionalidades fiscal, diagnóstico ou impressão como **homologadas**, coletar resultado real por módulo, nunca apenas mocks.
3. O verificador local `node scripts/release-evidence.mjs <arquivo.json> [core|fiscal|diagnostics|printing|full]` exige campos obrigatórios e falha em resultados `SIMULATED`, mas **não consulta o GitHub nem a autoridade fiscal**: referências e autenticidade devem ser conferidas fora do comando.
4. O manifesto de exemplo é apenas template; não usar evidências inventadas para liberar produto.
5. Publicação e merge somente após revisão independente, CI/QA/Windows verdes e autorização expressa. Manter a main e a branch paralela de multiempresa intocadas.

**Estado atual:** CI e smoke podem provar partes automatizadas; NF-e/NFS-e, diagnóstico e impressão física são **NÃO HOMOLOGADOS** até execução supervisionada real.
