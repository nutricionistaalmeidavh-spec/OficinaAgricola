# Primeiro acesso — ArtiSys Oficina (P0–P7)

Objetivo: cliente instala, configura a empresa e começa a trabalhar sem suporte técnico ou terminal. Core R$ 0, open source, self-hosted, PostgreSQL/ACBr locais. Fiscal não bloqueia operação.

| Fase | Código | Responsabilidade do cliente | Gate |
|---|---|---|---|
| P0 Instalação | Electron e PostgreSQL/ACBr já embarcados | Instalar e criar administrador | Teste real Windows limpo |
| P1 Empresa | Wizard com validação da unidade | Preencher nome e endereço; CNPJ no cadastro/fiscal | Obrigatório para operar |
| P2 Operação | Atalhos e estado de serviços, técnicos, caixa e impressora | Configurar conforme uso; confirmar impressão manualmente | Opcional |
| P3 Fiscal | Integração às telas de NF-e/NFC-e/NFS-e, A1/A3 e municípios existentes | CNPJ, regime, UF, IBGE, certificado e credenciamento | Não confundir setup com homologação |
| P4 Testes | Diagnóstico real do banco e estados locais | Homologar com emitente real | Sem simulação de SEFAZ |
| P5 Liberação | Estados separados de oficina e fiscal | Começar operação; fiscal após aprovação legal | Nunca autorizar produção por checkbox |
| P6 UX | Progresso no banco por unidade, etapas opcionais e retomada | Fazer depois, reabrir ou concluir | Persistência após reiniciar |
| P7 QA | Testes unitários, RBAC, contratos UI, CI e smoke | Validar certificado/homologação externa | Nenhum merge com gate vermelho |

## Fluxo implementado
1. Primeiro ADMIN é criado no bootstrap local seguro, sem senha padrão.
2. O ADMIN entra no assistente automaticamente enquanto não concluir a configuração.
3. Nome real e endereço são exigidos para habilitar Começar a trabalhar.
4. Serviços, técnicos, caixa, impressora e fiscal podem ser deixados para depois sem impedir vendas/OS.
5. Progresso e confirmação manual da impressora são salvos por unidade no banco, não em armazenamento paralelo do navegador.
6. Diagnóstico não realiza transmissão nem libera produção. Dados fiscais e certificado ficam no módulo próprio.
7. A qualquer momento o ADMIN reabre Primeiro acesso no menu.

## Limites técnicos e legais
- Não houve prova de instalação Windows limpa, impressora ou token A3 físico nesta implementação; os checks da CI devem confirmar onde possível.
- Cadastro fiscal, certificado presente, seleção de ambiente e confirmação administrativa não provam homologação ou autorização de produção.
- Testes reais NF-e/NFC-e e NFS-e dependem de credenciamento, regras tributárias e implementações estaduais/municipais.
- Não alterar secrets; sem serviço pago obrigatório, sem publicação/deploy e sem merge antecipado.
