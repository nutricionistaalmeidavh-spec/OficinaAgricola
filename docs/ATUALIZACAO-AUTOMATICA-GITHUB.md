# Atualização automática pelo GitHub — ArtiSys Oficina

## Funcionamento para o cliente (Windows x64)

O aplicativo Electron empacotado consulta a última versão **estável** em `nutricionistaalmeidavh-spec/OficinaAgricola` (GitHub Releases) após o PostgreSQL local iniciar e, depois, a cada 6 horas enquanto estiver aberto.

1. Sem internet ou sem release publicada, o sistema continua funcionando offline, sem alterar dados e sem bloquear o usuário.
2. Quando encontra uma versão superior à versão instalada, pergunta se o usuário quer baixar.
3. O instalador NSIS oficial é baixado para o diretório de dados do aplicativo, juntamente com seu checksum SHA-256. O hash é verificado **antes** de qualquer execução. O aplicativo rejeita releases sem checksum, com nome divergente, pré-releases e URLs fora do repositório.
4. Com a atualização validada, o usuário escolhe **Instalar e reiniciar** ou **Depois**. Ao confirmar, o Oficina encerra o backend e o PostgreSQL gerenciado; somente depois inicia o instalador silencioso e reabre o aplicativo instalado.
5. Dados, arquivos, usuários, licenças e o cluster PostgreSQL permanecem sob `%LOCALAPPDATA%\ArtiSys\Oficina`. A instalação usa `deleteAppDataOnUninstall: false`. O próprio smoke Windows verifica a persistência após reinstalação.

A atualização é do executável instalado: **não** se deve executar `git pull` nos computadores dos clientes. Não há uso de APIs pagas, servidor de atualizações proprietário, Git instalado no cliente, ou assinatura mensal obrigatória.

**Separação de edições:** cada release oficial pode conter dois instaladores Windows distintos: `ArtiSys-Oficina-Setup-<versão>-Windows-x64.exe` (edição livre) e `ArtiSys-Oficina-Setup-<versão>-Windows-x64-Commercial.exe` (edição comercial), cada um com SHA-256 próprio. A edição comercial é montada explicitamente com `stage-oficina-edition.mjs --commercial`, instalada em ambiente de QA e validada pelo manifesto interno `commercialActivation=true`. A edição livre mantém `commercialActivation=false` e nunca pede licença. O atualizador automático continua **desativado na edição comercial**: o cliente comercial deve receber a nova versão pelo canal de distribuição específico, não pela atualização da edição livre.

## Como publicar uma versão oficial

1. Alterar a versão estável (`version`) em `package.json` e `package-lock.json`, enviar por PR e validar os gates antes do merge.
2. No **push para `main`** após o merge, o workflow `Windows · Instalador limpo` compila o executável Windows NSIS e executa testes, instalação limpa e reinstalação PostgreSQL; o workflow de QA visual também roda no mesmo commit.
3. Só depois de todos os gates `quality`, `windows-nfse-bundle`, `visual-shell (desktop)`, `visual-shell (mobile)` e `NSIS · Windows x64 limpo` aprovados, o publicador verifica o SHA256, cria a tag `vX.Y.Z` apontando para o commit aprovado e publica os dois executáveis e seus respectivos arquivos `.exe.sha256` no GitHub Releases. Se já existe um release oficial com apenas a edição livre, o publicador pode anexar a edição comercial sem substituir o executável gratuito.
4. Se essa versão já foi publicada, o publicador não cria outra release. Para publicar alterações futuras, incremente a versão em ambos os manifestos.
5. O cliente detecta automaticamente a nova versão na próxima verificação.

Tags externas ainda podem disparar a compilação, mas são recusadas quando não apontarem para a `main` atual ou não coincidirem com a versão do pacote. Arquivo ausente, SHA256 divergente, falha em testes ou QA incompleto **impedem publicação**. Pull requests **nunca** publicam releases.

## Limites e operação segura

- O aplicativo deve já ter sido instalado com uma versão contendo este atualizador. Instalações antigas precisam receber essa versão inicial pelo instalador.
- O GitHub Releases precisa estar acessível via HTTPS. A atualização não depende dele para operar offline.
- A distribuição usa binários NSIS e verificação SHA-256. **Assinatura Authenticode para eliminar avisos do Windows é recomendada como evolução opcional**, mas não é dependência de serviço pago do núcleo.
- Não há instalação automática enquanto o usuário trabalha: a instalação requer confirmação, para evitar perda de alterações ainda não salvas.
- Antes de liberar um NSIS comercial, conferir `commercialActivation=true` no recurso interno do executável instalado e concluir o QA físico do processo comercial. O código de ativação de seis dígitos deve ser emitido na Central com `ACTIVATION_PEPPER` do Worker, nunca fabricado no cliente ou gravado como texto no repositório.
