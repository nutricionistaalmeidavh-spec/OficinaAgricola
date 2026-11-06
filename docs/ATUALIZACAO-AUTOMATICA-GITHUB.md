# Atualização automática pelo GitHub — ArtiSys Oficina

## Funcionamento para o cliente (Windows x64)

O aplicativo Electron empacotado consulta a última versão **estável** em `nutricionistaalmeidavh-spec/OficinaAgricola` (GitHub Releases) após o PostgreSQL local iniciar e, depois, a cada 6 horas enquanto estiver aberto.

1. Sem internet ou sem release publicada, o sistema continua funcionando offline, sem alterar dados e sem bloquear o usuário.
2. Quando encontra uma versão superior à versão instalada, pergunta se o usuário quer baixar.
3. O instalador NSIS oficial é baixado para o diretório de dados do aplicativo, juntamente com seu checksum SHA-256. O hash é verificado **antes** de qualquer execução. O aplicativo rejeita releases sem checksum, com nome divergente, pré-releases e URLs fora do repositório.
4. Com a atualização validada, o usuário escolhe **Instalar e reiniciar** ou **Depois**. Ao confirmar, o Oficina encerra o backend e o PostgreSQL gerenciado; somente depois inicia o instalador silencioso e reabre o aplicativo instalado.
5. Dados, arquivos, usuários, licenças e o cluster PostgreSQL permanecem sob `%LOCALAPPDATA%\ArtiSys\Oficina`. A instalação usa `deleteAppDataOnUninstall: false`. O próprio smoke Windows verifica a persistência após reinstalação.

A atualização é do executável instalado: **não** se deve executar `git pull` nos computadores dos clientes. Não há uso de APIs pagas, servidor de atualizações proprietário, Git instalado no cliente, ou assinatura mensal obrigatória.

**Separação de edições:** o release automático padrão é da edição livre. A edição que exige ativação comercial não faz cross-update para a livre: o canal comercial precisará de publicação separada e explícita.

## Como publicar uma versão oficial

1. Aplicar alterações na `main` com testes aprovados; atualizar os campos `version` de `package.json` e `package-lock.json` para a nova versão estável (ex.: `1.0.1`).
2. Criar a tag exata no commit atual da `main`: `git tag v1.0.1 && git push origin v1.0.1`.
3. O workflow `Windows · Instalador limpo` executa gates, compila binários OSS, gera NSIS, realiza os smokes de primeiro acesso e reinstalação e **somente na tag** publica o instalador e seu arquivo `.exe.sha256` no GitHub Releases.
4. O cliente detecta automaticamente a nova versão na próxima verificação.

Tag fora do commit atual da `main`, divergência do `package.json`, ausência do artefato, checksum divergente ou falha em qualquer gate impedem publicação. Pull requests **nunca** publicam releases.

## Limites e operação segura

- O aplicativo deve já ter sido instalado com uma versão contendo este atualizador. Instalações antigas precisam receber essa versão inicial pelo instalador.
- O GitHub Releases precisa estar acessível via HTTPS. A atualização não depende dele para operar offline.
- A distribuição usa binários NSIS e verificação SHA-256. **Assinatura Authenticode para eliminar avisos do Windows é recomendada como evolução opcional**, mas não é dependência de serviço pago do núcleo.
- Não há instalação automática enquanto o usuário trabalha: a instalação requer confirmação, para evitar perda de alterações ainda não salvas.
- Antes de liberar um novo NSIS, conferir que o pacote é de edição livre e que o QA físico exigido pelo processo comercial foi realizado.
