import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('OS separa recebimento manual da cobrança pendente Pix/TEF e expõe copia e cola',async()=>{
 const ui=await readFile(new URL('../public/app-orders.js',import.meta.url),'utf8');
 assert.match(ui,/id="collectBtn"/);
 assert.match(ui,/function collectionModal/);
 assert.match(ui,/\/api\/payment-intents\/capabilities/);
 assert.match(ui,/\/api\/payment-intents/);
 assert.match(ui,/pix_payload/);
 assert.match(ui,/PIX_STATIC/);
 assert.match(ui,/syncCollection/);
 assert.match(ui,/não dá baixa/);
 assert.match(ui,/pagamento manual/i);
});
