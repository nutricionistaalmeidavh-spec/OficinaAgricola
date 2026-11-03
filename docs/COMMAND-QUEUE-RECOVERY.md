# Recuperação de operações pendentes — ArtiSys Oficina

## O que o funcionário vê

Ao salvar um cliente, concluir uma venda, movimentar estoque, registrar pagamento ou executar outra mutação suportada, o sistema persiste a intenção **antes de enviá-la** ao servidor da oficina. Se a conexão cair depois do envio, a operação aparece no topo:

> **1 operação aguardando confirmação · Tentar novamente**

A operação permanece no navegador mesmo após reiniciar ou atualizar a página. Quando a máquina principal voltar a responder, o mesmo comando é reenviado com a mesma chave idempotente. Se o servidor já tiver confirmado a operação, retorna o resultado anterior: **não há segunda baixa no estoque ou lançamento de caixa**.

O usuário não informa nem precisa conhecer `requestId`. Pode clicar em **Tentar novamente** para reprocessar as pendências da própria conta.

## Implementação (100% local e sem mensalidade)

| Camada | Fonte de verdade | Responsabilidade |
|---|---|---|
| `public/command-queue.js` | IndexedDB do perfil do navegador | Fila de comandos pendentes; identidade por usuário; payload JSON e `requestId` |
| `public/app-core.js` | UI / EventBus local | Envio HTTP, exibição do aviso, atualização pontual após confirmação |
| `src/platform/idempotency.js` | SQLite do servidor | Comando identificado por chave + usuário + rota, resultado persistido transacionalmente |
| `src/platform/outbox.js` | SQLite do servidor | Eventos de domínio persistidos e recuperáveis após falha |
| `src/platform/event-bus.js` | Memória do servidor | Distribuição de eventos já persistidos para listeners do backend |

O EventBus local do navegador é apenas para notificações. **Não executa operações de negócio**; quem decide a execução é o SQLite do servidor.

## Contratos de recuperação e segurança

- IndexedDB grava o comando **antes do HTTP**; falha na gravação impede o envio (fail closed).
- A fila grava método HTTP, rota, dados JSON e `requestId`, mas **nunca o token de sessão ou o cabeçalho Authorization**.
- Inicialização, login, logout, criação de usuários/senhas e uploads de anexo **não entram na fila**, assim como requisições não JSON ou com payload maior que 128 KiB. Esses casos usam o fluxo original e não devem anunciar recuperação persistente.
- O registro usa ID + nome do usuário da sessão para restringir reenvios, e o navegador o isola por origem/protocolo.
- Respostas HTTP de sucesso removem o comando do IndexedDB; erros determinísticos de validação (4xx, exceto 401/403/408/429) também o removem porque a operação foi recusada.
- Erros de rede, timeout ou 5xx mantêm a operação **pendente**, pois o commit pode ter ocorrido. HTTP 401/403 mantém o comando, aguardando revisão/autorização, sem fingir que houve confirmação.
- Reenvio automático no login, na reconexão do servidor local e ao voltar a ficar online; comandos com mais de **30 minutos** só são reenviados por ação manual.
- A mesma tentativa reutiliza o `requestId`. Um segundo formulário com os mesmos dados de uma operação ainda pendente não cria outra mutação.
- Não armazenar token no IndexedDB reduz a exposição, mas os dados JSON pendentes podem conter informações comerciais e pessoais. Use perfis Windows/navegador protegidos e não compartilhe a conta do computador.
- Se os dados locais do navegador forem apagados, a fila não pode ser recuperada daquele dispositivo. O livro de operações no servidor continua sendo o controle canônico. Um comando já aplicado nunca deve ser descartado simplesmente para “limpar” a fila.
- Se a operação for recusada pelo backend por regra de negócio ou conflito, não haverá tentativa automática infinita. O funcionário receberá feedback e poderá revisar os dados.

## Verificações

- `node --test tests/command-queue.test.js`: rede indisponível, reenvio pós-reload, isolamento de conta, prevenção de duplicidade, 4xx/5xx, credenciais excluídas, eventos de UI, IndexedDB indisponível e pendências antigas.
- `scripts/qa-demo.mjs desktop|mobile`: navegador real confirma um cadastro no servidor, interrompe a resposta ao cliente, recarrega a UI e verifica que a fila é zerada **sem criar cliente duplicado**. Também exercita o botão **Tentar novamente** após uma falha antes do envio.
- `npm run ci`: testes, lint, build e E2E; workflow Windows valida instalador NSIS sem publicar.

## Limitações explícitas

A fila do navegador **não substitui backup do SQLite** nem é um mecanismo de sincronização de dois servidores independentes. Não promete entrega para uploads ou operações não persistíveis. Respostas perdidas após confirmação são cobertas pela idempotência do backend; uma chave nova para outra operação legítima é tratada como comando novo.

**Core obrigatório: R$ 0, sem SaaS, sem Cloudflare, fila, gateway ou serviço pago externo.** O GitHub Actions é ferramenta de QA e não roda no computador do cliente.
