import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=async path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('SDK da NFS-e nacional é dependência OSS de runtime versionada',async()=>{
 const manifest=JSON.parse(await read('package.json'));
 const lock=JSON.parse(await read('package-lock.json'));
 assert.equal(manifest.dependencies['@useinvio/nfse-sdk'],'3.0.0');
 assert.equal(manifest.devDependencies?.['@useinvio/nfse-sdk'],undefined);
 assert.equal(lock.packages[''].dependencies['@useinvio/nfse-sdk'],'3.0.0');
 for(const name of ['@useinvio/nfse-sdk','@xmldom/xmldom','@xmldom/is-dom-node','node-forge','xml-crypto','xpath']){
   assert.equal(lock.packages['node_modules/'+name].dev,undefined,'Módulo de runtime marcado como dev: '+name);
 }
});
test('instalador Windows inclui SDK offline e sua árvore de dependências',async()=>{
 const [build,installer]=await Promise.all([
   read('scripts/stage-nfse-national.mjs'),read('electron-builder.yml')]);
 assert.match(build,/@useinvio\/nfse-sdk/);
 assert.match(build,/node_modules/);
 assert.match(installer,/from: build\/nfse-national/);
 assert.match(installer,/to: nfse-national/);
});
