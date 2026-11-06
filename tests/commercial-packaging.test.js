import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('installer comercial tem modo explícito e não altera core open source',()=>{
 const installer=readFileSync('scripts/build-electron.ps1','utf8');
 const electron=readFileSync('electron/main.js','utf8');
 const config=readFileSync('electron-builder.yml','utf8');
 assert.match(installer,/\[switch\]\$Commercial/);
 assert.match(installer,/oficina-edition\.json/);
 assert.match(config,/build\/oficina-edition\.json/);
 assert.match(electron,/commercialActivation/);
 assert.match(electron,/OFICINA_REQUIRE_COMMERCIAL_ACTIVATION/);
 assert.match(installer,/if\s*\(\$Commercial\)/);
});
