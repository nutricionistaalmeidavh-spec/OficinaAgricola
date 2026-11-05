// Empacota o SDK MIT e suas dependências, sem instalação no computador do cliente.
import {cpSync,existsSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decodeNationalLogoPng,OFFICIAL_NFSE_LOGO_SOURCE} from '../src/platform/nfse-national-danfse-assets.js';

const base=resolve('build/nfse-national');
const modules=resolve(base,'node_modules');
const packages=['@useinvio/nfse-sdk','@xmldom/xmldom','@xmldom/is-dom-node',
  'node-forge','xml-crypto','xpath'];
rmSync(base,{recursive:true,force:true});
for(const pkg of packages){
 const source=resolve('node_modules',pkg);
 if(!existsSync(source))throw Error('SDK NFS-e ausente no build: '+pkg+
   '. Execute npm ci no ambiente de compilação.');
 const dest=resolve(modules,pkg);
 mkdirSync(dirname(dest),{recursive:true});
 cpSync(source,dest,{recursive:true});
}
const entry=resolve(modules,'@useinvio/nfse-sdk/dist/index.js');
if(!existsSync(entry))throw Error('SDK NFS-e não contém dist/index.js');
const sdk=await import(pathToFileURL(entry).href);
for(const method of ['buildDpsFromJson','loadPfxFromBuffer','signDps','verifyDps']){
 if(typeof sdk[method]!=='function')throw Error('SDK NFS-e incompatível: '+method);
}
console.info('NFS-e Nacional: SDK OSS testado e incluído no bundle do instalador.');

const brandFile=resolve(base,'danfse-logo.png');
const localOriginal=resolve('src/platform/danfse-logo.png');
let png;
if(existsSync(localOriginal))png=readFileSync(localOriginal);
else {
 // A rede só é utilizada na montagem do pacote, nunca pelo computador do cliente.
 // Futura inclusão do PNG oficial versionado dispensa esta etapa.
 const reply=await fetch(OFFICIAL_NFSE_LOGO_SOURCE,{signal:AbortSignal.timeout(30000),
   headers:{Accept:'image/png'}});
 if(!reply.ok||new URL(reply.url).hostname!=='www.gov.br')
   throw Error('Fonte oficial da logomarca da NFS-e indisponível ou redirecionada');
 const raw=Buffer.from(await reply.arrayBuffer());
 if(raw.length>3*1024*1024)throw Error('PNG oficial da NFS-e excede 3 MiB');
 png=raw;
}
const decoded=decodeNationalLogoPng(png);
if(decoded.width<200||decoded.height<40||decoded.width/decoded.height<2)
 throw Error('Logomarca NFS-e oficial horizontal com proporções inválidas');
writeFileSync(brandFile,png,{flag:'wx',mode:0o600});
console.info('DANFSe: logomarca horizontal oficial incorporada sem dependência remota no runtime.');
