import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const smoke=readFileSync('scripts/smoke-postgres-portable.ps1','utf8');
test('P0: smoke reinstala NSIS e mantém cluster PostgreSQL, usuários e arquivos',()=>{
 for(const required of ['Start-Process -FilePath $exe.FullName','api/setup/status','api/auth/login','afterCustomers','Get-FileHash $secret','PASS: Reinstalação PostgreSQL'])
  assert.ok(smoke.includes(required),'Ausente: '+required);
 assert.ok(!smoke.includes('database.sqlite'));
});
test('P0: instalador não publica e não apaga dados do cliente',()=>{
 const builder=readFileSync('scripts/build-electron.ps1','utf8');
 const workflow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 assert.ok(builder.includes('--publish never'));
 assert.ok(workflow.includes('--publish never'));
 assert.ok(!smoke.includes('Remove-Item -LiteralPath $root'));
});
