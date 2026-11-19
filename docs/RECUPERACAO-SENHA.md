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

Fluxo sem ponte de segredos entre contas:

1. O instalador comercial envia e-mail + identificador da instalação à Central de Licenças `pdv-artisys` na conta Cloudflare `sistema.artisys@gmail.com`.
2. A Central confirma a licença ativa no D1, emite OTP de seis dígitos por 15 minutos, guarda somente o digest e cria uma assinatura HMAC de uso restrito para o envio.
3. A Central chama via HTTPS o Worker `oficina-password-mailer.nutricionistaalmeidavh.workers.dev`, da conta `nutricionistaalmeidavh@gmail.com`, que tem o Cloudflare Email Sending.
4. Antes de enviar, esse Worker pede autorização ao endpoint `/v1/password-recovery/relay-authorize` da Central; a assinatura HMAC, o vínculo da licença e o OTP são validados, e uma marca `relayed_at` atômica impede múltiplos envios com o mesmo bilhete.
5. O Worker envia o código ao e-mail da licença; o Oficina recebe a confirmação via Cloudflare e permite definir a nova senha no PostgreSQL local. O código não retorna ao cliente pela API.
6. O core gratuito não faz nenhuma dessas solicitações e funciona totalmente offline/self-hosted.

Não é necessário SMTP Hostinger, senha da caixa ou token compartilhado entre as duas contas Cloudflare. O envio pela conta pessoal utiliza o serviço Cloudflare Email Sending já disponível; não altera DNS nem contrata outro serviço. Em caso de indisponibilidade, o atendimento pode gerar código na Central administrada, sem alterar dados locais.

## Segurança e QA

Validar a publicação do Worker da Central e o Worker de envio, o recebimento real de uma mensagem de teste, token expirada e de uso único, rejeição de assinatura adulterada e vínculo incorreto, bem como invalidar sessões antigas no PostgreSQL após alteração da senha. Não distribuir atualização ao cliente até checar o teste real e o instalador comercial.

