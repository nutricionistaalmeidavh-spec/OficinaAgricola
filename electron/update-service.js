import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const UPDATE_REPOSITORY='nutricionistaalmeidavh-spec/OficinaAgricola';
const RELEASE_API='https://api.github.com/repos/'+UPDATE_REPOSITORY+'/releases/latest';
const MAX_INSTALLER_BYTES=2_000_000_000;

function parseVersion(input){
  const matched=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(input));
  if(!matched)throw Error('Versão inválida: '+input);
  const parts=matched.slice(1).map(Number);
  if(parts.some(part=>!Number.isSafeInteger(part)))throw Error('Versão numérica inválida');
  return parts;
}

export function compareVersions(left,right){
  const a=parseVersion(left),b=parseVersion(right);
  for(let index=0;index<3;index++){
    if(a[index]>b[index])return 1;
    if(a[index]<b[index])return -1;
  }
  return 0;
}

function officialAssetUrl(value,tag,name){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&url.hostname==='github.com'&&
      url.username===''&&url.password===''&&url.search===''&&url.hash===''&&
      url.pathname==='/'+UPDATE_REPOSITORY+'/releases/download/'+tag+'/'+name;
  }catch{return false;}
}

/**
 * Instalações NSIS nunca devem atualizar diretamente a partir da branch git.
 * O release/tag, o nome da arquitetura e o checksum são obrigatórios.
 * O canal comercial tem distribuição separada: não deve receber o instalador livre.
 */
export function selectUpdate(release,currentVersion){
  if(!release||release.draft||release.prerelease)return null;
  const tag=String(release.tag_name||'');
  if(!/^v\d+\.\d+\.\d+$/.test(tag))return null;
  try{if(compareVersions(tag,currentVersion)<=0)return null;}
  catch{return null;}
  const version=tag.slice(1);
  const filename='ArtiSys-Oficina-Setup-'+version+'-Windows-x64.exe';
  const assets=Array.isArray(release.assets)?release.assets:[];
  const exe=assets.find(asset=>asset?.name===filename&&asset.state==='uploaded');
  const checksum=assets.find(asset=>asset?.name===filename+'.sha256'&&asset.state==='uploaded');
  if(!exe||!checksum)return null;
  if(!officialAssetUrl(exe.browser_download_url,tag,filename)||
      !officialAssetUrl(checksum.browser_download_url,tag,filename+'.sha256'))return null;
  if(exe.size!==undefined&&(!Number.isSafeInteger(exe.size)||exe.size<1||exe.size>MAX_INSTALLER_BYTES))return null;
  return {version,filename,downloadUrl:exe.browser_download_url,checksumUrl:checksum.browser_download_url,
    digest:typeof exe.digest==='string'&&/^sha256:[0-9a-f]{64}$/i.test(exe.digest)?exe.digest.slice(7).toLowerCase():null};
}

export function parseChecksum(contents,filename){
  for(const line of String(contents).trim().split(/\r?\n/)){
    const matched=/^([0-9a-f]{64})(?:\s+\*?(.+))?$/i.exec(line.trim());
    if(matched&&matched[2]===filename)return matched[1].toLowerCase();
  }
  throw Error('SHA256 de release ausente, incorreto ou com nome divergente');
}

export async function checkGitHubUpdate(currentVersion,{fetchImpl=globalThis.fetch}={}){
  const response=await fetchImpl(RELEASE_API,{
    headers:{Accept:'application/vnd.github+json','User-Agent':'ArtiSys-Oficina-Updater'},
    signal:AbortSignal.timeout(15000)
  });
  if(response.status===404)return null; // primeiro release ainda não foi publicado
  if(!response.ok)throw Error('GitHub Releases indisponível: HTTP '+response.status);
  return selectUpdate(await response.json(),currentVersion);
}

export async function downloadVerifiedUpdate(update,directory,{fetchImpl=globalThis.fetch,onProgress=()=>{}}={}){
  if(!update||!/^ArtiSys-Oficina-Setup-\d+\.\d+\.\d+-Windows-x64\.exe$/.test(update.filename))
    throw Error('Pacote de atualização inválido');
  const tag='v'+update.version;
  if(!officialAssetUrl(update.downloadUrl,tag,update.filename)||
     !officialAssetUrl(update.checksumUrl,tag,update.filename+'.sha256'))
    throw Error('Origem da atualização não autorizada');

  const checksumResponse=await fetchImpl(update.checksumUrl,{
    headers:{'User-Agent':'ArtiSys-Oficina-Updater'},
    signal:AbortSignal.timeout(15000)
  });
  if(!checksumResponse.ok)throw Error('Checksum de release indisponível');
  const expected=parseChecksum((await checksumResponse.text()).slice(0,4096),update.filename);
  if(update.digest&&update.digest!==expected)throw Error('SHA256 divergente entre GitHub e manifesto');

  const response=await fetchImpl(update.downloadUrl,{
    headers:{'User-Agent':'ArtiSys-Oficina-Updater'},
    signal:AbortSignal.timeout(15*60*1000)
  });
  if(!response.ok||!response.body)throw Error('Download do instalador não autorizado');
  const size=Number(response.headers?.get?.('content-length')||0);
  if(size>MAX_INSTALLER_BYTES)throw Error('Instalador excede tamanho permitido');
  await mkdir(directory,{recursive:true});
  const destination=join(directory,update.filename);
  const temporary=destination+'.part';
  const hash=createHash('sha256');
  let total=0;
  try{
    await pipeline(Readable.fromWeb(response.body),new Transform({
      transform(chunk,encoding,callback){
        total+=chunk.length;
        if(total>MAX_INSTALLER_BYTES){callback(Error('Instalador excede tamanho permitido'));return;}
        hash.update(chunk);
        onProgress(total,size);
        callback(null,chunk);
      }
    }),createWriteStream(temporary,{flags:'w',mode:0o600}));
    if(total===0||hash.digest('hex')!==expected)throw Error('SHA256 inválido: instalador corrompido');
    await rename(temporary,destination);
    return destination;
  }finally{
    await rm(temporary,{force:true}).catch(()=>{});
  }
}
