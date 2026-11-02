import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { migrateAssistencia } from '../src/assistencia-schema.js';
import { createAssistenciaServer } from '../src/server-assistencia.js';

test('serve shell responsivo da assistência e assets locais',async(t)=>{
 const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);const app=createAssistenciaServer({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>{app.close();db.close()});const {port}=app.address();const base=`http://127.0.0.1:${port}`;
 const home=await fetch(base+'/');assert.equal(home.status,200);const html=await home.text();assert.match(html,/Assistência Técnica/);assert.match(html,/viewport/);assert.match(html,/styles\.css/);assert.match(html,/app-core\.js/);assert.match(html,/app-orders\.js/);assert.match(html,/app-assistencia\.js/);assert.match(html,/data-page="services"/);assert.match(html,/data-page="sales"/);
 const css=await (await fetch(base+'/styles.css')).text();assert.match(css,/--green/);assert.match(css,/@media/);
 const scripts=['app-core.js','app-catalog.js','app-orders.js','app-operations.js','app-assistencia.js','app-admin.js'];const js=(await Promise.all(scripts.map(async name=>await (await fetch(base+'/'+name)).text()))).join('\n');assert.match(js,/renderDashboard/);assert.match(js,/renderWorkOrders/);assert.match(js,/renderFinance/);assert.match(js,/renderServices/);assert.match(js,/renderSales/);assert.match(js,/addQuoteItemRow/);assert.match(js,/data-check-response/);
});
