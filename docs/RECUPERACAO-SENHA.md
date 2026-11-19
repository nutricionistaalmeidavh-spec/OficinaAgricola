# Recuperação de senha — ArtiSys Oficina

A recuperação assistida é disponível **somente** na edição comercial ativada por e-mail, vinculada a uma instalação específica. O núcleo MIT livre permanece totalmente offline/self-hosted e não passa a exigir Cloudflare.

## Para o cliente

1. Instale a nova versão sobre a instalação existente. Não desinstale, não apague o perfil `%LOCALAPPDATA%\\ArtiSys\\Oficina`.
2. Na tela de login, clique em **Esqueci minha senha**.
3. Informe o e-mail da licença comercial ativa nessa máquina.
4. Quando o Cloudflare Email Service estiver habilitado, a Central envia um código de seis dígitos ao e-mail (15 minutos, uso único). Se a Central ainda usa envio manual, a tela comunica explicitamente que o código deve ser solicitado ao suporte ArtiSys.
5. Digite o código, a nova senha forte e a confirmação. Entre com o mesmo nome de usuário administrador.

## Para o suporte

Na Central de Licenças `pdv-artisys`, o botão **Recuperação** de uma instalação ativa gera um código manual de seis dígitos que pode ser repassado ao titular após validação de identidade. Essa alternativa continua possível quando o envio automático não está configurado. Não confundir código de ativação da licença (48 horas) e código de recuperação (15 minutos).

A senha nova só existe no PostgreSQL privado da máquina do cliente. A Central D1 guarda e-mail/licença/instalação e digests de códigos, não recebe senha nem arquivos operacionais. A troca atualiza o hash scrypt do titular administrador e invalida suas sessões anteriores; não apaga registros da oficina.

## Infraestrutura comercial opcional

A automação de envio utiliza `send_email` no Worker Cloudflare da Central, remetente `welcome@artisys.dev`. Para enviar a qualquer endereço, o Cloudflare Email Service exige Workers Paid e domínio de envio configurado/verificado. A conta do Worker precisa autorizar Email Sending e ter SPF/DKIM validados. Não há compra nem credencial silenciosa do runtime. Sem o binding, o endpoint recusa envio com HTTP 503 em vez de simular sucesso.

Checklist antes de publicar o Worker: build de prévia e produção aprovados, `EMAIL` presente nas configurações do Worker, domínio `artisys.dev` liberado para envio, teste de uma conta autorizada com código entregue, confirmação única no PostgreSQL real, tentativa expirada e revogação de sessões. Testar os dois instaladores NSIS Windows e preservar os dados após atualização.
