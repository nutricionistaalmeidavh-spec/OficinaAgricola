import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
test('P0 - smoke Windows reinstala in place e confirma login, OS e dados preservados',()=>{
 const repeats=smoke.match(/Start-Process -FilePath \$installer\.FullName/g)||[];
 assert.ok(repeats.length>=2,'reinstalação silenciosa ausente');
 assert.match(smoke,/api\/setup\/status/);
 assert.match(smoke,/api\/auth\/login/);
 assert.match(smoke,/api\/customers\/\$\(\$customer\.id\)/);
 assert.match(smoke,/PASS: Reinstalação/);
});
test('P0 - instalador não faz publicação silenciosa nem apaga o diretório de dados',()=>{
 const builder=readFileSync('scripts/build-electron.ps1','utf8');
 const flow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 assert.match(builder,/--publish never/);
 assert.match(flow,/--publish never/);
 assert.doesNotMatch(smoke,/Remove-Item.+ArtiSys\\Oficina/i);
});
