import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('desktop usa PostgreSQL e journal transacional para idempotência, sem EventBus SQLite',()=>{
 const desktop=readFileSync('electron/main.js','utf8');
 const journal=readFileSync('src/platform/postgres-command-journal.js','utf8');
 const gateway=readFileSync('src/platform/postgres-unified-gateway.js','utf8');
 const smoke=readFileSync('scripts/smoke-postgres-portable.ps1','utf8');
 assert.match(desktop,/await startPostgresDesktop\(\)/);
 assert.doesNotMatch(desktop,/startLocalServer|dispatchOutbox|createEventRuntime|events\.jsonl/);
 assert.match(journal,/createPostgresCommandJournal/);
 assert.match(journal,/command_idempotency/);
 assert.match(journal,/pg_advisory_xact_lock/);
 assert.match(gateway,/journalEligible/);
 assert.match(smoke,/api\/customers/);
 assert.match(smoke,/customer\.id/);
});
