// Descoberta fail-closed do motor fiscal distribuído com Electron (Windows x64).
// Nenhum certificado, chave privada, senha ou INI de contribuinte é empacotado.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';

const REQUIRED=['acbrlib-worker.exe','ACBrNFe64.dll','ACBrNFSe64.dll'];
const MAX_MANIFEST_BYTES=64*1024;
const MAX_BINARY_BYTES=200*1024*1024;
const SHA=/^[0-9a-f]{64}$/;

function safeBundleFile(name){
  return typeof name==='string'&&name.length<=180&&name.includes('/')===false
    ? /^[A-Za-z0-9._-]+$/.test(name)&&name!=='.'&&name!=='..'
    : typeof name==='string'&&/^deps\/[A-Za-z0-9._-]+$/.test(name);
}
function within(root,path){
  const diff=relative(root,path);
  return diff!==''&&!diff.startsWith('..'+sep)&&diff!=='..'&&!isAbsolute(diff);
}
function verifyFile(root,name,expected){
  if(!safeBundleFile(name)||!SHA.test(expected))return false;
  const file=join(root,name);
  if(!within(root,file)||!existsSync(file))return false;
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>MAX_BINARY_BYTES)return false;
  return createHash('sha256').update(readFileSync(file)).digest('hex')===expected;
}
export function verifyBundledFiscal({resourcesPath,platform=process.platform,arch=process.arch}={}){
  if(platform!=='win32'||arch!=='x64'||!resourcesPath||!isAbsolute(resourcesPath))
    return {valid:false,reason:'Plataforma não elegível para o pacote Windows x64'};
  try{
    const root=join(resourcesPath,'fiscal'),path=join(root,'acbr-bundle.json');
    if(!existsSync(path)||lstatSync(path).size>MAX_MANIFEST_BYTES)
      return {valid:false,reason:'Manifesto ACBr inexistente ou fora do limite'};
    const manifest=JSON.parse(readFileSync(path,'utf8'));
    const entries=manifest?.files;
    if(manifest.schemaVersion!==1||manifest.architecture!=='x64'||
       manifest.source!=='https://svn.code.sf.net/p/acbr/code/trunk2'||
       !/^\d+$/.test(String(manifest.revision||''))||
       !entries||typeof entries!=='object'||Array.isArray(entries)||
       Object.keys(entries).length<REQUIRED.length||Object.keys(entries).length>40||
       !REQUIRED.every(name=>Object.hasOwn(entries,name))||
       !Object.entries(entries).every(([name,digest])=>verifyFile(root,name,digest)))
      return {valid:false,reason:'Manifesto ou arquivos ACBr inválidos'};
    return {valid:true,root,manifest};
  }catch{
    return {valid:false,reason:'Pacote ACBr corrompido ou incompleto'};
  }
}
function ensurePrivateConfig(file){
  if(!existsSync(file))try{
    writeFileSync(file,'[Principal]\nLogNivel=0\n',{flag:'wx',mode:0o600});
  }catch(error){if(error.code!=='EEXIST')throw error}
}
export function configureBundledFiscal({
  resourcesPath,dataRoot,platform=process.platform,arch=process.arch,env=process.env
}={}){
  // Configuração manual/sidecar existe para desenvolvimento e migração:
  // não misturar provedores nem alterar caminhos explícitos.
  if(env.FISCAL_LOCAL_PROVIDER_URL||env.FISCAL_ACBR_NFE_LIB||
     env.FISCAL_ACBR_NFSE_LIB||env.FISCAL_ACBR_WORKER_EXE)
    return {active:false,reason:'Configuração manual fiscal preservada'};
  const check=verifyBundledFiscal({resourcesPath,platform,arch});
  if(!check.valid)return {active:false,reason:check.reason};
  if(!dataRoot||!isAbsolute(dataRoot))return {active:false,reason:'Perfil privado indisponível'};
  const root=join(dataRoot,'fiscal');
  const configs=join(root,'config'),input=join(root,'entrada');
  mkdirSync(configs,{recursive:true,mode:0o700});
  mkdirSync(input,{recursive:true,mode:0o700});
  const nfeConfig=join(configs,'ACBrLibNFe.ini');
  const nfseConfig=join(configs,'ACBrLibNFSe.ini');
  ensurePrivateConfig(nfeConfig);
  ensurePrivateConfig(nfseConfig);
  Object.assign(env,{
    FISCAL_ACBR_NFE_LIB:join(check.root,'ACBrNFe64.dll'),
    FISCAL_ACBR_NFSE_LIB:join(check.root,'ACBrNFSe64.dll'),
    FISCAL_ACBR_WORKER_EXE:join(check.root,'acbrlib-worker.exe'),
    FISCAL_ACBR_NFE_CONFIG:nfeConfig,
    FISCAL_ACBR_NFSE_CONFIG:nfseConfig,
    FISCAL_ACBR_INPUT_DIR:input
  });
  return {active:true,mode:'bundled-local',revision:check.manifest.revision};
}
