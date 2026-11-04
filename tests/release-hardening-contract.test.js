import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('P0 - smoke Windows verifica reinstalação sem perder administrador e clientes',()=>{
 const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
 assert.match(smoke,/Reinstalação preservou cadastro e autenticação/);
 assert.match(smoke,/\/api\/customers\/\$\(\$customer\.id\)/);
 assert.match(smoke,/setup\/status/);
 assert.match(smoke,/Start-Process -FilePath \$installer\.FullName/);
});

test('P0 - verificador offline exige SHA-256 de distribuição',()=>{
 const verify=readFileSync('scripts/verify-installer.ps1','utf8');
 assert.match(verify,/SHA256/);
 assert.match(verify,/ExpectedSha256/);
 assert.match(verify,/Get-AuthenticodeSignature/);
 assert.match(verify,/throw/);
});

test('P1 - evidências físicas não são presumidas por checks simulados',()=>{
 const body=readFileSync('docs/RELEASE-HOMOLOGACAO-P0-P3.md','utf8');
 assert.match(body,/SEFAZ/);
 assert.match(body,/impressora física/i);
 assert.match(body,/veículo real/i);
 assert.match(body,/não homologado/i);
});
