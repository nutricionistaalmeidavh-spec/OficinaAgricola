# Matriz de QA E2E — Cliente → veículo → OS → entrega

**Escopo:** desktop, mobile, HTTP e SQLite real, 100% local e self-hosted. Nenhum SaaS, assinatura ou credencial fiscal é requisito de execução. Não usar dados de produção.

## Gate de segurança para release

A branch **não está automaticamente homologada**: todos os testes automatizados aplicáveis precisam estar verdes, o instalador limpo precisa passar e testes com equipamento fiscal/OBD/impressora reais requerem execução supervisionada. Nunca autorizar NF-e/NFS-e em produção a partir de testes simulados.

| Prioridade | Cenário | Evidência obrigatória | Automação |
| --- | --- | --- | --- |
| P0 | Cliente/veículo/OS e vínculos corretos | OS, snapshots, histórico | tests/jornada-cliente-os.e2e.test.js |
| P0 | Duplo clique e requestId reutilizado | Uma única OS, conflito em payload diferente | tests/jornada-resiliencia.e2e.test.js |
| P0 | Dois usuários editam a mesma OS | Uma alteração válida, outra HTTP 409 | tests/jornada-resiliencia.e2e.test.js |
| P0 | PIX simultâneo e cobrança excedente | Ledger e recebimentos sem duplicações | tests/jornada-resiliencia.e2e.test.js |
| P0 | Resposta perdida/replay após reinício | Mesmos IDs, sem novo estoque/cobrança | tests/jornada-resiliencia.e2e.test.js |
| P0 | SIGKILL após commit | Persistência SQLite sem shutdown coordenado | tests/jornada-resiliencia.e2e.test.js, Linux |
| P0 | Cancelamento com peça/pagamento ativo | HTTP 409, estorno explícito antes de cancelar | tests/jornada-resiliencia.e2e.test.js |
| P0 | OS cancelada e contas a receber | Sem saldo pendente ou nova cobrança; histórico preservado | tests/jornada-resiliencia.e2e.test.js |
| P1 | Orçamento pendente alterado | HTTP 409; rejeitar/revisar/reenviar | tests/jornada-resiliencia.e2e.test.js |
| P1 | Revisão de orçamento recusado | Nova proposta aprovada, total correto | tests/jornada-cliente-os.e2e.test.js |
| P1 | Estorno de estoque e recebimento pela UI | Confirmação, motivo, visualização do estorno | scripts/qa-cliente-os.mjs |
| P1 | Garantia e retorno por veículo | Registro de garantia e histórico | scripts/qa-demo.mjs, testes automotive |
| P2 | Reprovação e revisão pela UI | Screenshot antes/depois e sem erros JS | scripts/qa-cliente-os.mjs |
| P2 | Interrupção de rede e replay na UI | 1 transição após reconectar | scripts/qa-cliente-os.mjs |
| P2 | RBAC atendimento/técnico/financeiro | Controles corretos por perfil + HTTP 403 | scripts/qa-cliente-os.mjs e teste HTTP |
| P2 | Desktop 1440 × 900 / mobile 390 × 844 | Capturas, logs e summary.json | workflow artisys-qa-stage7.yml |
| P3 | Backup, restore e integridade | SQLite e anexos restaurados, hashes/PRAGMA | tests/jornada-resiliencia.e2e.test.js |
| P3 | Instalador Windows novo, sem base preexistente | Build/instalação e smoke do executável | workflow instalador Windows |
| P3 | PDF gerado, documento legível | Assinatura %PDF e download real na UI | tests/jornada-cliente-os.e2e.test.js e script browser |
| P3 | Emissão fiscal real | Credenciamento/certificado e ambiente homologação, resposta SEFAZ/provedor | **Manual: bloqueador antes de afirmar homologação real** |
| P3 | Impressora fiscal/térmica real | Dispositivo físico, spool, falha de papel, segunda via | **Manual: não substituído por PDF** |
| P3 | Diagnóstico OBD-II real | Veículo, adaptador autorizado, comunicação e códigos DTC | **Manual: não substituído por mocks** |
| P3 | Queda física de energia e storage danificado | Teste em dispositivo físico, restore completo | **Manual: SIGKILL não equivale a power-loss físico** |

### Comandos de regressão

\`\`\`sh
npm ci
npm run ci
node --test tests/jornada-resiliencia.e2e.test.js
# Browser: workflow ArtiSys QA · Etapa 07 (desktop + mobile)
\`\`\`

## Políticas de operação

- Cancelar a OS **não** faz estorno financeiro ou reposição de peça automaticamente: o operador registra cada estorno com motivo, para preservar rastreabilidade.
- O cancelamento fica bloqueado com peça/recebimento ativo. Após os estornos, a OS mantém o orçamento original como documento histórico, mas não aparece em valores a receber.
- Aprovação pendente impede alteração invisível da proposta. É necessário reprovar com motivo, revisar e submeter novamente.
- Em falha de rede, repetir o **mesmo requestId**, nunca disparar uma operação nova cegamente.
- REST, armazenamento, autenticação, caixa e PDF locais não exigem serviço pago. Serviços externos, dispositivos ou certificados necessários para NF-e/NFS-e são condicionantes explícitos, jamais silenciosos.
- Nenhuma publicação/merge em main deve ser feita enquanto os gates críticos estiverem vermelhos ou não revisados.
