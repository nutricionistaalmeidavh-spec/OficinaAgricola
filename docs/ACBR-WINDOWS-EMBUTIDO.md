# ACBr embarcado no instalador Windows x64 — branch de integração

## Distribuição sem mensalidade / sem Python no cliente

O instalador Windows NSIS inclui **recursos offline** em `resources/fiscal/`:
- `acbrlib-worker.exe`: executor autônomo gerado com PyInstaller dos fontes `src/platform/acbrlib-worker.py`;
- `ACBrNFe64.dll` e `ACBrNFSe64.dll`: bibliotecas ACBr compiladas de fontes oficiais via SVN + Lazarus/FPC;
- `deps/*.dll`: dependências nativas LGPL/compatíveis (LibXML2/OpenSSL e auxiliares);
- `acbr-bundle.json`: revisão de origem e SHA-256 por arquivo;
- `THIRD_PARTY_LICENSES.txt`: avisos sobre origens e licenças.

O Electron valida todos os hashes antes de expor o provedor. Um bundle parcial ou alterado nunca é habilitado silenciosamente. **Não** há download de DLL em tempo de execução, Python externo, ACBr Pro/Demo, licença comercial, gateway remoto ou SaaS no núcleo. O empacotamento é responsabilidade do computador/CI de build.

## Dados privados do contribuinte

Os recursos do instalador são executáveis compartilhados. Dados fiscais ficam exclusivamente no perfil do Windows:

`%LOCALAPPDATA%\ArtiSys\Oficina\fiscal\config\ACBrLibNFe.ini`

`%LOCALAPPDATA%\ArtiSys\Oficina\fiscal\config\ACBrLibNFSe.ini`

`%LOCALAPPDATA%\ArtiSys\Oficina\fiscal\entrada\`

Esses arquivos são criados na primeira inicialização do executável quando o bundle é íntegro; **não** são sobrescritos nas atualizações. Certificados digitais, senhas e configuração fiscal do contribuinte **nunca** são adicionados ao pacote nem ao Git.

A emissão permanece bloqueada até a habilitação explícita em `fiscal_settings` e depende de: CNPJ/UF/regime, certificado e credenciamento, configuração nativa do ACBr, INI tributário revisado e homologação junto à SEFAZ ou ao município. **O gerador automático de INIs tributários completos não foi implementado**; o bundle resolve a distribuição da infraestrutura, não a conformidade fiscal da operação.

## Construção reprodutível — Windows builder (não cliente)

Requisitos apenas da máquina desenvolvedora/CI: Node 22, Git, SVN, Lazarus 4.0/FPC, Python 3.12 e PyInstaller open source. O pipeline também faz download dos fontes ACBr por HTTPS em revisão explícita e das dependências open source para impressão.

```powershell
npm ci
npm run ci
npm run build
npm run test:e2e
python -m pip install pyinstaller==6.16.0
python -m PyInstaller --noconfirm --clean --onefile --console --name acbrlib-worker --distpath build/fiscal-worker --workpath build/pyinstaller-tmp --specpath build/pyinstaller-src src/platform/acbrlib-worker.py
./scripts/build-acbr-native.ps1 -Revision 48608
node scripts/stage-fiscal-bundle.mjs
npx electron-builder --win nsis --x64 --publish never
./scripts/smoke-installer.ps1
```

Também é possível usar `npm run desktop:dist` após preparar o compilador, pois `scripts/build-electron.ps1` executa as etapas. O workflow Windows executa a compilação do source ACBr e falha se não obtiver **as duas** DLLs válidas e suas dependências.

### Proveniência e licenciamento

- SVN original: https://svn.code.sf.net/p/acbr/code/trunk2
- Código fonte ACBr sob LGPL: https://projetoacbr.com.br/fontes/
- Documentação de distribuição nativa: https://acbr.sourceforge.io/ACBrLib/ComoInstalarDistribuir.html
- Dependências ACBr: https://acbr.sourceforge.io/ACBrLib/Dependencias.html
- PyInstaller: https://pyinstaller.org/

Os binários compilados são derivados de fontes de terceiros; não possuem assinatura digital oficial do ACBr. Respeitar direitos autorais, obrigações de redistribuição LGPL e licenças de terceiros. O build ainda precisa ser validado em Windows limpo; não declarar emissão de NF-e/NFS-e homologada com base em smoke de carregamento de DLL.

## Testes e segurança

1. CI: `tests/fiscal-bundle.test.js` verifica integridade, configuração privada, ausência de dependência silenciosa, fallbacks e não alteração do modo manual.
2. CI Python: `test_fiscal_worker_cli.py` verifica autodiagnóstico e bloqueio sem DLL.
3. Windows: `scripts/smoke-installer.ps1` valida hashes, `--self-test` do executor, `--probe` nas duas DLLs e configurações no perfil após instalação.
4. QA desktop/mobile e testes de negócio permanecem obrigatórios.

**Fora do escopo desse pacote:** motor tributário, DANFE completo, certificados emitidos, homologação municipal, credenciamento, contingência fiscal e emissão real em produção.
