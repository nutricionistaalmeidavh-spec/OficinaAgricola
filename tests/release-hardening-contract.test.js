import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('P0: reinstalação NSIS verifica login e cliente no PostgreSQL embutido',()=>{
 const s=readFileSync('scripts/smoke-postgres-portable.ps1','utf8');
 for(const required of ['Start-Process -FilePath $exe.FullName','Reinstalação PostgreSQL preservou administrador','afterCustomers','api/setup/status','api/auth/login','Get-FileHash $secret','qa-reinstall-preserve.txt']){
  assert.ok(s.includes(required),'Smoke não valida '+required);
 }
 assert.ok(!s.includes('database.sqlite'),'Não reinserir SQLite no smoke Windows');
});
test('P0: artefato de distribuição exige SHA256 e oferece assinatura opcional',()=>{
 const s=readFileSync('scripts/verify-installer.ps1','utf8');
 for(const required of ['SHA256','ExpectedSha256','Get-AuthenticodeSignature','throw'])
  assert.ok(s.includes(required),'Ausente: '+required);
});
test('P1: gate documenta provas físicas não simuladas',()=>{
 const s=readFileSync('docs/RELEASE-HOMOLOGACAO-P0-P3.md','utf8');
 for(const required of ['SEFAZ','impressora física','veículo real','NÃO HOMOLOGADOS'])
  assert.ok(s.includes(required),'Ausente: '+required);
});
