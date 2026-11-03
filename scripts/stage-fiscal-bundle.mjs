// Monta um único pacote fiscal auditável (somente binários compilados de fontes OSS).
// Falha se faltar worker, NFe, NFSe ou dependências declaradas.
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyBundledFiscal} from '../src/platform/fiscal-bundle.js';

if(process.platform!=='win32')throw new Error('Staging do instalador fiscal exige build Windows x64');
const dir=resolve('build/fiscal');
const worker=resolve('build/fiscal-worker/acbrlib-worker.exe');
const native=resolve('build/fiscal-native');
const nativeDeps=join(native,'deps');
const required=[
  ['acbrlib-worker.exe',worker],
  ['ACBrNFe64.dll',join(native,'ACBrNFe64.dll')],
  ['ACBrNFSe64.dll',join(native,'ACBrNFSe64.dll')]
];
const rev=readFileSync(resolve('build/acbr-revision.txt'),'utf8').trim();
if(!/^\d+$/.test(rev))throw new Error('Revisão SVN ACBr não verificada');
if(!existsSync(nativeDeps)||!readdirSync(nativeDeps).some(name=>/\.dll$/i.test(name)))
  throw new Error('ACBr compilado sem dependências nativas obrigatórias');
rmSync(dir,{recursive:true,force:true});
mkdirSync(join(dir,'deps'),{recursive:true});
const entries={};
const put=(name,file)=>{
  if(!existsSync(file)||!statSync(file).isFile()||statSync(file).size<256)
    throw new Error('Arquivo fiscal ausente, vazio ou inconsistente: '+name);
  const dest=join(dir,name);
  copyFileSync(file,dest);
  entries[name]=createHash('sha256').update(readFileSync(dest)).digest('hex');
};
for(const [name,file] of required)put(name,file);
for(const name of readdirSync(nativeDeps).filter(name=>/^[A-Za-z0-9._-]+\.dll$/i.test(name)))
  put('deps/'+name,join(nativeDeps,name));
const notice=[
  'ACBrLib — Projeto ACBr, autores e contribuidores.',
  'Fontes oficiais: https://svn.code.sf.net/p/acbr/code/trunk2',
  'Revisão SVN: '+rev,
  'Licença LGPL 2.1 ou posterior; veja https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html',
  'Dependências de terceiros: OpenSSL e libxml2, distribuídas como DLLs separadas.',
  'Este pacote não contém assinatura digital do ACBr, certificados de clientes, segredos',
  'nem artefatos Pro/Demo. As DLLs são construídas dos fontes pelo pipeline.',
  'O projeto e os scripts de construção permanecem disponíveis para substituição/recompilação.'
].join('\n')+'\n';
writeFileSync(join(dir,'THIRD_PARTY_LICENSES.txt'),notice);
entries['THIRD_PARTY_LICENSES.txt']=createHash('sha256').update(notice).digest('hex');
writeFileSync(join(dir,'acbr-bundle.json'),JSON.stringify({
  schemaVersion:1,architecture:'x64',source:'https://svn.code.sf.net/p/acbr/code/trunk2',
  revision:rev,files:entries
},null,2));
const check=verifyBundledFiscal({resourcesPath:resolve('build'),platform:'win32',arch:'x64'});
if(!check.valid)throw new Error('Bundle fiscal falhou integridade: '+check.reason);
console.log('Pacote ACBr OSS validado, arquivos:',Object.keys(entries).length,'revisão:',rev);
