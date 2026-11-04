import test from 'node:test';
import assert from 'node:assert/strict';
import {requestPayloadLimit,MAX_BANK_IMPORT_REQUEST_BYTES} from '../src/platform/billing-http-limits.js';

test('OFX/CSV aceita JSON com arquivo de até 1MB, sem aumentar limite das demais rotas',()=>{
 assert.equal(requestPayloadLimit('POST','/api/billing/statements/import'),MAX_BANK_IMPORT_REQUEST_BYTES);
 assert.ok(MAX_BANK_IMPORT_REQUEST_BYTES>=1150000);
 assert.equal(requestPayloadLimit('POST','/api/billing/statements'),1048576);
 assert.equal(requestPayloadLimit('GET','/api/billing/statements/import'),1048576);
 assert.equal(requestPayloadLimit('POST','/api/billing/statements/import/evil'),1048576);
});
test('anexos mantêm 7MB e limite geral continua configurável no backend local',()=>{
 assert.equal(requestPayloadLimit('POST','/api/work-orders/1/attachments'),7*1024*1024);
 assert.equal(requestPayloadLimit('POST','/api/work-orders/0/attachments'),1048576);
 assert.equal(requestPayloadLimit('POST','/api/billing/statements/import',16384),MAX_BANK_IMPORT_REQUEST_BYTES);
 assert.equal(requestPayloadLimit('POST','/api/unrelated',16384),16384);
});
