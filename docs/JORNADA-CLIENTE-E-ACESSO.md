# Jornada do cliente e acesso externo opcional

A primeira OS pode cadastrar cliente e equipamento no mesmo formulário. Cada cadastro confirmado fica selecionado: se uma etapa posterior falhar, tente novamente sem repetir o cadastro. Os comandos conservam identificadores para recuperar confirmações incertas. Rascunhos não enviados não são sincronizados entre máquinas; trocar unidade, sair ou fechar a janela pede confirmação quando há trabalho não salvo.

O dashboard, o quadro e os relatórios recebem o mesmo contrato de etapas do servidor. Aprovação pendente e aprovação confirmada são etapas distintas. Depois de salvar o diagnóstico, a tela usa a versão retornada pela API; conflito com outro usuário conserva o texto e oferece revisão antes de sobrescrever.

## Aprovação pelo cliente

Na OS, **Solicitar aprovação** registra que o orçamento aguarda decisão e abre a preparação do link. Isso não envia e-mail nem WhatsApp. Gere e copie o link para compartilhar pelo canal de atendimento. O link também pode ser preparado em **CRM e Frotas**, escolhendo a OS pelo número comercial, cliente ou placa. Novo link revoga links ativos anteriores; repetir a mesma tentativa de geração após falha de rede conserva o link e seu prazo. O token permanece em memória no navegador e só seu hash é persistido no banco.

Na instalação local, links apontam para a própria máquina e a interface informa essa limitação. Não existe túnel pago obrigatório nem publicação automática. Para usar aprovação em outro dispositivo, o administrador pode configurar um proxy HTTPS self-hosted e gratuito, por exemplo Caddy ou nginx, no mesmo servidor do gateway:

1. Ter um domínio sob seu controle, certificado TLS válido e conectividade de entrada apropriada ao ambiente.
2. Configurar `OFICINA_PUBLIC_ORIGIN=https://oficina.seu-dominio.example` no processo do gateway. Aceita somente uma origem HTTPS, sem caminho, query ou credenciais. Isso não altera secrets existentes nem cria acesso por conta própria.
3. Configurar o proxy para encaminhar essa origem a `127.0.0.1:3344`, preservando o Host público. Somente o Host explicitamente configurado é aceito. O gateway continua escutando exclusivamente no loopback e ignora cabeçalhos Forwarded como fonte de confiança.
4. A configuração inicial do primeiro administrador permanece restrita ao endereço local. Crie-o antes de disponibilizar o proxy.
5. Abrir um link de teste a partir de outro dispositivo, conferir a OS, decidir e consultar o estado na oficina. Confirmar que outra empresa/unidade não consegue consultar ou decidir o orçamento.

Custos de domínio e infraestrutura, se escolhidos, são externos ao core. O produto não contrata nem exige serviço pago. Sem essa configuração, a operação local continua funcionando.

## Valores financeiros

“Aprovado/vendido no mês” soma os orçamentos aprovados e vendas concluídas conforme suas datas comerciais. Não significa notas fiscais emitidas. “Recebido” segue a data dos eventos de recebimento e estorno; despesas seguem a data de pagamento. “A receber das aprovações do mês” exclui aprovações de meses anteriores, mesmo que ainda estejam em aberto. O resultado exibido é recebido menos despesas pagas, sem declaração de lucro contábil.

Na venda manual, a prévia mostra subtotal, desconto e total. O backend confere preços e valor esperado antes de gravar; se houve alteração, o formulário conserva os itens, atualiza a prévia e pede nova conferência. Reenvios após confirmação incerta não devem criar outra venda. Fiscal e recebimento continuam separados: criar documento não baixa estoque ou registra receita novamente.
