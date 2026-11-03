import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('desktop Electron initializes the same outbox dispatcher and domain EventBus as local CLI',()=>{
 const desktop=readFileSync('electron/main.js','utf8');
 assert.match(desktop,/createEventRuntime/);
 assert.match(desktop,/dispatchOutbox/);
 assert.match(desktop,/createAssistenciaServer\(\{\s*db,\s*storageDir,\s*eventRuntime\s*\}\)/);
 assert.match(desktop,/events\.jsonl/);
 const smoke=readFileSync('scripts/smoke-installer.ps1','utf8');
 assert.match(smoke,/ENTITY_MUTATED/);
 assert.match(smoke,/events\.jsonl/);
});
