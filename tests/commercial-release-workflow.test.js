import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('release gera instaladores livre e comercial distintos e verifica manifestos instalados',()=>{
 const workflow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 assert.match(workflow,/stage-oficina-edition\.mjs --commercial/);
 assert.match(workflow,/ArtiSys-Oficina-Setup-\$version-Windows-x64/);
 assert.match(workflow,/\$base-Commercial\.exe/);
 assert.match(workflow,/commercialActivation -ne \$true/);
 assert.match(workflow,/commercialActivation -ne \$false/);
 assert.match(workflow,/\.exe\.sha256/);
 assert.match(workflow,/gh release upload/);
 assert.match(workflow,/api\/license\/status/);
 assert.match(workflow,/api\/setup\/initialize/);
});

test('edição comercial verifica atualizações sem aceitar instalador livre',()=>{
 const updater=readFileSync('electron/updater.js','utf8');
 assert.doesNotMatch(updater,/isCommercial\)return/);
 assert.match(updater,/checkGitHubUpdate\(app\.getVersion\(\),\{isCommercial\}\)/);
});

test('edição NSIS transmite exigência de licença ao gateway PostgreSQL real',()=>{
 const electron=readFileSync('electron/main.js','utf8');
 const server=readFileSync('src/start-postgres-unified.js','utf8');
 assert.match(electron,/OFICINA_REQUIRE_COMMERCIAL_ACTIVATION:\s*commercialEditionRequired\(\)/);
 assert.match(server,/createOficinaCommercialLicense\(\{/);
 assert.match(server,/licenseControl\s*[,}]/);
});
