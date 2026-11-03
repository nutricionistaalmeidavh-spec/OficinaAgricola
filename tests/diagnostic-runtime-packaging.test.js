import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {resolveDiagnosticRunner} from '../src/platform/diagnostic-hardware.js';

test('installed Electron uses bundled bridge and ignores system Python',()=>{
 const root=mkdtempSync(join(tmpdir(),'artisys-diagnostic-runtime-'));
 try{
  const directory=join(root,'diagnostics','ArtiSys-Diagnostic-Bridge');
  mkdirSync(directory,{recursive:true});
  const exe=join(directory,'ArtiSys-Diagnostic-Bridge.exe');
  writeFileSync(exe,'test placeholder');
  const runner=resolveDiagnosticRunner({
    modulePath:join(root,'app.asar','dist','src','platform','diagnostic-hardware.js'),
    resourcesPath:root,platform:'win32',python:'C:/external/python.exe'
  });
  assert.equal(runner.command,exe);
  assert.deepEqual(runner.args,[]);
  assert.equal(runner.embedded,true);
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('installed Electron fails closed when packaged bridge is missing',()=>{
 const root=mkdtempSync(join(tmpdir(),'artisys-diagnostic-runtime-missing-'));
 try{
  assert.throws(()=>resolveDiagnosticRunner({
    modulePath:join(root,'app.asar','dist','src','platform','diagnostic-hardware.js'),
    resourcesPath:root,platform:'win32',python:'python'
  }),/ponte.*(instalação|instalad|ausente|encontrad)/i);
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('development server retains optional Python, without affecting installed package',()=>{
 const source='/workspace/src/platform/diagnostic-hardware.js';
 const runner=resolveDiagnosticRunner({modulePath:source,platform:'linux',python:'python3'});
 assert.equal(runner.command,'python3');
 assert.deepEqual(runner.args,['/workspace/src/platform/diagnostic-worker.py']);
 assert.equal(runner.embedded,false);
});

test('packaging contract bundles all Python-CAN dependencies and tests clean install',()=>{
 const yaml=readFileSync('electron-builder.yml','utf8');
 const workflow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
 assert.match(yaml,/extraResources:/);
 assert.match(yaml,/diagnostics\/ArtiSys-Diagnostic-Bridge/);
 assert.match(workflow,/Build bundled diagnostic bridge/);
 assert.match(workflow,/pyinstaller/i);
 assert.match(smoke,/ArtiSys-Diagnostic-Bridge.exe/);
 assert.match(smoke,/pythonCan/);
});
