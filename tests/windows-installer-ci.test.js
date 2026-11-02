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
