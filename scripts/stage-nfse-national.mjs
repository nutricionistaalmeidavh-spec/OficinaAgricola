// Empacota o SDK MIT e suas dependências, sem instalação no computador do cliente.
import {cpSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

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
