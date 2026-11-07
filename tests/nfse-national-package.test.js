import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('NFS-e desativada não instala SDK nem dependências transitivas',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
 assert.equal(pkg.dependencies['@useinvio/nfse-sdk'],undefined);
 assert.equal(lock.packages[''].dependencies['@useinvio/nfse-sdk'],undefined);
 for(const name of ['@useinvio/nfse-sdk','@xmldom/xmldom','@xmldom/is-dom-node','node-forge','xml-crypto','xpath'])
  assert.equal(lock.packages['node_modules/'+name],undefined,name);
});
test('bundle nacional não integra o instalador',()=>{
 const builder=readFileSync('electron-builder.yml','utf8');
 const script=readFileSync('scripts/build-electron.ps1','utf8');
 assert.doesNotMatch(builder,/build\/nfse-national/);
 assert.doesNotMatch(script,/stage-nfse-national/);
});
