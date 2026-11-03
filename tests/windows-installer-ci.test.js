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
 assert.match(smoke,/api\/setup\/status/);
 assert.match(smoke,/api\/setup\/initialize/);
 assert.match(smoke,/Get-FileHash/);
});

test('Windows fiscal bundle é obrigatório no NSIS e validado em instalação limpa',()=>{
 const flow=readFileSync('.github/workflows/windows-installer-smoke.yml','utf8');
 const builder=readFileSync('electron-builder.yml','utf8');
 const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
 const electron=readFileSync('electron/main.js','utf8');
 const nativeBuild=readFileSync('scripts/build-acbr-native.ps1','utf8');
 const stage=readFileSync('scripts/stage-fiscal-bundle.mjs','utf8');
 assert.match(flow,/pyinstaller==6\.16\.0/i);
 assert.match(flow,/choco install lazarus/i);
 assert.match(flow,/build-acbr-native\.ps1/);
 assert.match(flow,/stage-fiscal-bundle\.mjs/);
 assert.match(flow,/--probe/);
 assert.match(builder,/extraResources:/);
 assert.match(builder,/from: build\/fiscal/);
 assert.match(smoke,/acbr-bundle\.json/);
 assert.match(smoke,/--self-test/);
 assert.match(smoke,/--probe/);
 assert.match(smoke,/ACBrNFe64\.dll/);
 assert.match(smoke,/ACBrNFSe64\.dll/);
 assert.match(smoke,/config\\ACBrLibNFe\.ini/);
 assert.match(electron,/configureBundledFiscal/);
 assert.match(electron,/app\.isPackaged/);
 assert.match(nativeBuild,/svn.*export/i);
 assert.match(nativeBuild,/--build-mode=Win64-x86_64-CDECL/);
 assert.match(stage,/acbr-bundle\.json/);
 assert.doesNotMatch(flow,/acbrlib-pro|download.*demo|ACBr Pro/i);
});
