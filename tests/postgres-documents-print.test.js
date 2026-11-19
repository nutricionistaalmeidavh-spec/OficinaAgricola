import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mapLegacyNativeRoute} from '../src/platform/native-api-route-map.js';
import {createAsyncWorkshopHandler} from '../src/platform/async-workshop-handler.js';
import {createAsyncWorkshopDocuments} from '../src/platform/async-workshop-documents.js';

const kinds=['quote','work-order','delivery','receipt'];

test('all four work-order documents map to PostgreSQL routes for authorized users',()=>{
 for(const kind of kinds){
  const route=mapLegacyNativeRoute('GET',`/api/work-orders/17/documents/${kind}`);
  assert.equal(route?.path,`/v1/orders/17/documents/${kind}`);
  assert.deepEqual(route?.roles,['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO']);
 }
 for(const path of ['/api/work-orders/17/documents/orcamento/pdf',
   '/api/work-orders/17/documents/../../admin',
   '/api/work-orders/0/documents/quote'])
  assert.equal(mapLegacyNativeRoute('GET',path),null);
});

test('PostgreSQL-native documents render the existing quote and receipts from canonical SQL rows',async()=>{
 const rows={
  os:{id:17,os_number:125,status:'ORCAMENTO',entered_at:'2026-11-19T12:00:00Z',
   problem_reported:'Revisão',diagnosis:'',snapshot_customer:JSON.stringify({name:'Cliente & Cia',document:'1'}),
   snapshot_machine:JSON.stringify({type:'Trator',brand:'XYZ',model:'500',serialNumber:'ABC'})},
  company:{id:1,name:'Oficina Central',document:'000',phone:'999'},
  quote:{id:13,subtotal_cents:19900,discount_cents:0,total_cents:19900},
  items:[{id:1,kind:'SERVICO',description:'Troca <óleo>',quantity:1,unit_price_cents:19900,total_cents:19900}],
  receipts:[{id:1,method:'PIX',amount_cents:19900,received_at:'2026-11-19T12:00:00Z'}]
 };
 const statements=[],port={engine:'postgres',
  async first(sql,params){statements.push([sql,params]);if(sql.includes('FROM work_orders'))return rows.os;if(sql.includes('FROM company_settings'))return rows.company;if(sql.includes('FROM quotes'))return rows.quote;return null;},
  async all(sql,params){statements.push([sql,params]);if(sql.includes('FROM quote_items'))return rows.items;if(sql.includes('FROM receipts'))return rows.receipts;return [];}
 };
 const docs=createAsyncWorkshopDocuments(port);
 const rendered=await docs.renderWorkOrderDocument(17,'quote');
 assert.match(rendered,/Orçamento/);
 assert.match(rendered,/Oficina Central/);
 assert.match(rendered,/Cliente &amp; Cia/);
 assert.match(rendered,/Troca &lt;óleo&gt;/);
 assert.match(rendered,/R\$\s*199,00/);
 assert.equal(statements.filter(([sql])=>sql.includes('FROM work_orders')).length,1);
 assert.equal((await docs.renderWorkOrderDocument(17,'receipt')).includes('PIX'),true);
});

test('native document endpoint returns HTML and respects authenticated tenant roles',async()=>{
 let count=0;
 const serviceToken='s'.repeat(48),userToken='u'.repeat(48);
 const services={async validateSession(){return {role:'ATENDIMENTO'};},
  async renderWorkOrderDocument(id,kind){count++;assert.equal(id,17);assert.equal(kind,'quote');return '<!doctype html><html><body>Orçamento</body></html>';}};
 const handler=createAsyncWorkshopHandler({serviceToken,services});
 const request=(token)=>handler(new Request('http://localhost/v1/orders/17/documents/quote',{
  headers:{Authorization:'Bearer '+serviceToken,...(token?{'x-oficina-session':userToken}:{})}
 }));
 const rejected=await request(false);assert.equal(rejected.status,401);assert.equal(count,0);
 const result=await request(true);
 assert.equal(result.status,200);
 assert.match(result.headers.get('content-type'),/text\/html/);
 assert.match(await result.text(),/Orçamento/);
 assert.equal(count,1);
});

test('printing and previewing documents do not depend on popup windows',async()=>{
 const source=readFileSync(new URL('../public/document-print.js',import.meta.url),'utf8');
 const mockFrame={style:{},setAttribute(){},addEventListener(){},
  contentWindow:{print(){this.printed=true},focus(){},addEventListener(){}},
  remove(){this.removed=true}};
 const doc={body:{appendChild(frame){frame.onload?.()}},createElement(type){
   if(type==='iframe')return mockFrame;
   return {style:{},setAttribute(){},appendChild(){},addEventListener(){},remove(){}};
 }};
 const context={document:doc,window:{},setTimeout(){return 1},clearTimeout(){}};
 runInNewContext(source,context);
 assert.equal(typeof context.window.OficinaDocuments.printHtml,'function');
 await context.window.OficinaDocuments.printHtml('<html><body>OS</body></html>');
 assert.equal(mockFrame.contentWindow.printed,true);
 assert.doesNotMatch(source,/window\.open\s*\(/);
});
