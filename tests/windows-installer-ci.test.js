import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

test('Windows clean installer smoke is gated on PR with no auto publish',()=>{
 assert.ok(existsSync('.github/workflows/windows-installer-smoke.yml'));
 const flow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 assert.match(flow,/windows-latest/);
 assert.match(flow,/pull_request:/);
 assert.match(flow,/electron-builder --win nsis --x64 --publish never/);
 assert.match(flow,/scripts\/smoke-installer\.ps1/);
 assert.doesNotMatch(flow,/create-release|release-upload|publish always/);
 const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
 const postgres=readFileSync('scripts/smoke-postgres-portable.ps1','utf8');
 assert.match(flow,/scripts\/smoke-postgres-portable\.ps1/);
 assert.match(postgres,/api\/setup\/status/);
 assert.match(postgres,/api\/setup\/initialize/);
 assert.match(postgres,/engine -eq 'postgres'/);
 assert.match(smoke,/Get-FileHash/);
});

test('Windows desativa fiscal e não empacota ACBr nem NFS-e',()=>{
 const flow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 const builder=readFileSync('electron-builder.yml','utf8');
 const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
 const electron=readFileSync('electron/main.js','utf8');
 assert.doesNotMatch(flow,/build-acbr-native|stage-fiscal-bundle|windows-nfse-bundle|lazarus/i);
 assert.doesNotMatch(builder,/build\/fiscal|build\/nfse-national|acbrlib-worker/i);
 assert.doesNotMatch(electron,/configureBundledFiscal|OFICINA_BUNDLED_FISCAL_VERIFIED/);
 assert.match(smoke,/resources\\fiscal/);
 assert.match(smoke,/resources\\nfse-national/);
 assert.doesNotMatch(smoke,/ACBrNFe64|ACBrNFSe64|--probe/);
});

test('Instalação limpa mantém diagnóstico e PostgreSQL sem depender de fiscal',()=>{
 const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
 const pg=readFileSync('scripts/smoke-postgres-portable.ps1','utf8');
 assert.match(smoke,/ArtiSys-Diagnostic-Bridge/);
 assert.match(smoke,/PASS: Ponte J2534\/J1939/);
 assert.match(pg,/Start-Officina/);
 assert.match(pg,/Get-FileHash \$secret/);
});
