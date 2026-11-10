import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ReadableStream} from 'node:stream/web';
import {compareVersions, selectUpdate, parseChecksum, downloadVerifiedUpdate, UPDATE_REPOSITORY} from '../electron/update-service.js';

const tag='v1.0.1';
const filename='ArtiSys-Oficina-Setup-1.0.1-Windows-x64.exe';
const url='https://github.com/'+UPDATE_REPOSITORY+'/releases/download/'+tag+'/'+filename;
const checksumUrl=url+'.sha256';
const release={
  tag_name:tag, draft:false, prerelease:false,
  assets:[
    {name:filename,browser_download_url:url,state:'uploaded'},
    {name:filename+'.sha256',browser_download_url:checksumUrl,state:'uploaded'}
  ]
};
const response=(content)=>({
  ok:true, status:200, text:async()=>String(content),
  body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(content));controller.close();}})
});

test('compara versões estáveis, sem aceitar downgrade ou pré-release',()=>{
  assert.equal(compareVersions('1.0.1','1.0.0'),1);
  assert.equal(compareVersions('1.0.0','1.0.0'),0);
  assert.equal(compareVersions('1.0.9','1.1.0'),-1);
  assert.throws(()=>compareVersions('1.0.0-beta','1.0.0'));
});
test('seleciona somente release Windows x64 maior, oficial e com checksum',()=>{
  assert.equal(selectUpdate(release,'1.0.0')?.filename,filename);
  assert.equal(selectUpdate(release,'1.0.1'),null);
  assert.equal(selectUpdate({...release,prerelease:true},'1.0.0'),null);
  assert.equal(selectUpdate({...release,draft:true},'1.0.0'),null);
  assert.equal(selectUpdate({...release,assets:[release.assets[0]]},'1.0.0'),null);
  assert.equal(selectUpdate({...release,assets:[{...release.assets[0],browser_download_url:'https://attacker.invalid/file.exe'},release.assets[1]]},'1.0.0'),null);
  assert.equal(selectUpdate({...release,tag_name:'v1.0.1-beta'},'1.0.0'),null);
});
test('checksum exige SHA256 de 64 dígitos e nome exato',()=>{
  const hash='a'.repeat(64);
  assert.equal(parseChecksum(hash+'  '+filename,filename),hash);
  assert.throws(()=>parseChecksum('invalid  '+filename,filename));
  assert.throws(()=>parseChecksum(hash+'  outro.exe',filename));
});
test('baixa update validado sem tocar nos dados do aplicativo',async t=>{
  const root=mkdtempSync(join(tmpdir(),'oficina-updater-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('instalador simulado');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const fetchImpl=async requested=>requested===checksumUrl?response(hash+'  '+filename):response(bytes);
  const file=await downloadVerifiedUpdate(selectUpdate(release,'1.0.0'),root,{fetchImpl});
  assert.equal(readFileSync(file).toString(),bytes.toString());
  assert.equal(existsSync(join(root,filename+'.part')),false);
});
test('checksum inválido impede executar e descarta arquivo parcial',async t=>{
  const root=mkdtempSync(join(tmpdir(),'oficina-updater-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const fetchImpl=async requested=>requested===checksumUrl?response('0'.repeat(64)+'  '+filename):response('installer tampered');
  await assert.rejects(downloadVerifiedUpdate(selectUpdate(release,'1.0.0'),root,{fetchImpl}),/SHA256/i);
  assert.equal(existsSync(join(root,filename)),false);
  assert.equal(existsSync(join(root,filename+'.part')),false);
});
test('empacotador permite upgrade preservando base PostgreSQL fora do diretório instalado',()=>{
  const builder=readFileSync('electron-builder.yml','utf8');
  const shell=readFileSync('electron/main.js','utf8');
  const workflow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
  assert.match(builder,/deleteAppDataOnUninstall: false/);
  assert.match(shell,/startDesktopUpdates/);
  assert.match(workflow,/refs\/tags\/v/);
  assert.match(workflow,/sha256/);
  assert.match(workflow,/smoke-postgres-portable/);
});

const commercialFilename='ArtiSys-Oficina-Setup-1.0.1-Windows-x64-Commercial.exe';
const commercialUrl='https://github.com/'+UPDATE_REPOSITORY+'/releases/download/'+tag+'/'+commercialFilename;
const commercialRelease={...release,assets:[
  ...release.assets,
  {name:commercialFilename,browser_download_url:commercialUrl,state:'uploaded'},
  {name:commercialFilename+'.sha256',browser_download_url:commercialUrl+'.sha256',state:'uploaded'}
]};

test('seleciona atualização da mesma edição e recusa cruzamento comercial/livre',()=>{
  assert.equal(selectUpdate(commercialRelease,'1.0.0',{isCommercial:true})?.filename,commercialFilename);
  assert.equal(selectUpdate(commercialRelease,'1.0.0',{isCommercial:false})?.filename,filename);
  assert.equal(selectUpdate(release,'1.0.0',{isCommercial:true}),null);
  assert.equal(selectUpdate({...commercialRelease,assets:release.assets},'1.0.0',{isCommercial:true}),null);
  assert.equal(selectUpdate(commercialRelease,'1.0.1',{isCommercial:true}),null);
  assert.equal(selectUpdate({...commercialRelease,prerelease:true},'1.0.0',{isCommercial:true}),null);
});

test('edição comercial exige SHA256 específico do instalador comercial',async t=>{
  const root=mkdtempSync(join(tmpdir(),'oficina-commercial-updater-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('instalador comercial simulado');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const fetchImpl=async requested=>requested===commercialUrl+'.sha256'
    ?response(hash+'  '+commercialFilename)
    :response(bytes);
  const update=selectUpdate(commercialRelease,'1.0.0',{isCommercial:true});
  const file=await downloadVerifiedUpdate(update,root,{fetchImpl});
  assert.equal(readFileSync(file).toString(),bytes.toString());
  assert.ok(file.endsWith(commercialFilename));
  await assert.rejects(
    downloadVerifiedUpdate(update,root,{fetchImpl:async requested=>requested===commercialUrl+'.sha256'
      ?response(hash+'  '+filename):response(bytes)}),
    /SHA256/i
  );
});
