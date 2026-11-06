import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('installer comercial tem modo explícito e não altera core open source',()=>{
 const installer=readFileSync('scripts/build-electron.ps1','utf8');
 const electron=readFileSync('electron/main.js','utf8');
 const config=readFileSync('electron-builder.yml','utf8');
 assert.match(installer,/\[switch\]\$Commercial/);
 assert.match(installer,/stage-oficina-edition\.mjs/);
 assert.match(config,/build\/oficina-edition\.json/);
 assert.match(electron,/commercialActivation/);
 assert.match(electron,/OFICINA_REQUIRE_COMMERCIAL_ACTIVATION/);
 assert.match(installer,/if\s*\(\$Commercial\)/);
 const workflow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 assert.match(workflow,/node scripts\/stage-oficina-edition\.mjs/);
});

test('manifesto do builder é livre por padrão e comercial somente com --commercial',t=>{
 const tmp=mkdtempSync(join(tmpdir(),'oficina-edition-test-'));
 t.after(()=>rmSync(tmp,{recursive:true,force:true}));
 const script=resolve('scripts/stage-oficina-edition.mjs');
 for(const [args,commercialActivation] of [[[],false],[['--commercial'],true]]){
  const run=spawnSync(process.execPath,[script,...args],{cwd:tmp,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const edition=JSON.parse(readFileSync(join(tmp,'build','oficina-edition.json'),'utf8'));
  assert.deepEqual(edition,{product:'OFICINA',commercialActivation});
 }
});
