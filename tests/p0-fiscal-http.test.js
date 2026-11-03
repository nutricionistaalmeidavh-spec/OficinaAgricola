import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createUser} from '../src/auth.js';
import {createAppServer} from '../src/server.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder,transitionWorkOrder} from '../src/services/work-orders.js';
import {saveQuote,approveQuote} from '../src/services/quotes.js';
import {createLocalFiscalProvider} from '../src/platform/local-fiscal-provider.js';
import {setFiscalSettings,getFiscalSettings} from '../src/services/fiscal-settings.js';

async function request(base,path,{method='GET',token,body}={}){
  const headers={};if(token)headers.Authorization='Bearer '+token;
  if(body!==undefined)headers['Content-Type']='application/json';
  const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const txt=await res.text();
  return {status:res.status,data:txt?JSON.parse(txt):null};
}
async function setup(t,{fiscalProvider=null}={}){
  const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
  createUser(db,{username:'admin',password:'Admin@1234',name:'Administrador',role:'ADMIN'});
  createUser(db,{username:'technician',password:'Tech@12345',name:'Técnico',role:'TECNICO'});
  const server=createAppServer({db,fiscalProvider});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close()});
  const base='http://127.0.0.1:'+server.address().port;
  const admin=(await request(base,'/api/auth/login',{method:'POST',body:{username:'admin',password:'Admin@1234'}})).data.token;
  const tech=(await request(base,'/api/auth/login',{method:'POST',body:{username:'technician',password:'Tech@12345'}})).data.token;
  return {db,base,admin,tech};
}
function createQuotedOS(db){
  const customer=createCustomer(db,{name:'Oficina Demo'});
  const machine=createMachine(db,{customerId:customer.id,type:'TRATOR',brand:'Teste',model:'X1'});
  const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Trocar filtro'});
  transitionWorkOrder(db,os.id,'DIAGNOSTICO');
  saveQuote(db,os.id,{discountCents:100,items:[
    {kind:'PECA',description:'Filtro',quantity:1,unitPriceCents:5000},
    {kind:'MAO_DE_OBRA',description:'Troca',quantity:1,unitPriceCents:5000}
  ]});
  approveQuote(db,os.id);
  return {customer,machine,os};
}

test('HTTP P0: relatórios completos com RBAC e listagem de OS paginada até o fim',async t=>{
  const {db,base,admin,tech}=await setup(t);
  const {customer,machine}=createQuotedOS(db);
  for(let i=0;i<220;i++){
    const os=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Histórico '+i});
    db.prepare("UPDATE work_orders SET status='ENTREGUE',delivered_at='2026-11-02T12:00:00.000Z' WHERE id=?").run(os.id);
  }
  const qs='?from=2026-11-01T00%3A00%3A00Z&to=2026-12-01T00%3A00%3A00Z';
  const report=await request(base,'/api/reports'+qs,{token:admin});
  assert.equal(report.status,200);
  assert.equal(report.data.deliveredCount,220);
  assert.equal(report.data.openCount,1);
  assert.equal(report.data.statusCounts.ENTREGUE,220);
  assert.ok(report.data.finance);
  const redacted=await request(base,'/api/reports'+qs,{token:tech});
  assert.equal(redacted.status,200);
  assert.equal(redacted.data.finance,null);

  let cursor=null,seen=[],total;
  do{
    const url='/api/work-orders/page?limit=40'+(cursor?'&cursor='+cursor:'');
    const result=await request(base,url,{token:admin});
    assert.equal(result.status,200);
    total=result.data.total;
    seen.push(...result.data.items.map(row=>row.id));
    cursor=result.data.nextCursor;
  }while(cursor);
  assert.equal(total,221);
  assert.equal(seen.length,221);
  assert.equal(new Set(seen).size,221);
});

test('HTTP P0: fiscal só para financeiro/admin, rascunho não pode simular emissão',async t=>{
  const {db,base,admin,tech}=await setup(t);
  const {os}=createQuotedOS(db);
  const denied=await request(base,'/api/fiscal',{token:tech});
  assert.equal(denied.status,403);
  const body={originType:'OS',originId:os.id,kind:'NFE',requestId:'http-fiscal-nfe'};
  const created=await request(base,'/api/fiscal/drafts',{method:'POST',token:admin,body});
  assert.equal(created.status,200);
  assert.equal(created.data.amount_cents,4950);
  const replay=await request(base,'/api/fiscal/drafts',{method:'POST',token:admin,body});
  assert.equal(replay.data.id,created.data.id);
  const deniedPost=await request(base,'/api/fiscal/drafts',{method:'POST',token:tech,body:{...body,requestId:'other'}});
  assert.equal(deniedPost.status,403);
  const submit=await request(base,'/api/fiscal/'+created.data.id+'/submit',{method:'POST',token:admin,body:{requestId:'send'}});
  assert.notEqual(submit.status,200);
  assert.match(submit.data.error,/emissor|configurad/i);
  const doc=await request(base,'/api/fiscal/'+created.data.id,{token:admin});
  assert.equal(doc.data.status,'RASCUNHO');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
});

test('HTTP P0: resposta simulada só vale pelo contrato de provider explícito',async t=>{
  const provider={name:'fixture-teste',transmit:async()=>({status:'AUTORIZADA',environment:'HOMOLOGACAO',protocol:'SIMULATED',accessKey:'TESTE',xml:'<NFe>test-only</NFe>'})};
  const {db,base,admin}=await setup(t,{fiscalProvider:provider});
  setFiscalSettings(db,{issuerCnpj:'11222333000181',issuerUf:'MG',municipalityIbge:'3170107',taxRegime:'SIMPLES',enabled:true});
  const {os}=createQuotedOS(db);
  const created=await request(base,'/api/fiscal/drafts',{method:'POST',token:admin,body:{originType:'OS',originId:os.id,kind:'NFSE',requestId:'fiscal-test'}});
  assert.equal(created.status,200);
  const sent=await request(base,'/api/fiscal/'+created.data.id+'/submit',{method:'POST',token:admin,body:{}});
  assert.equal(sent.status,200);
  assert.equal(sent.data.status,'AUTORIZADA_HOMOLOGACAO');
  const repeat=await request(base,'/api/fiscal/'+created.data.id+'/submit',{method:'POST',token:admin,body:{}});
  assert.notEqual(repeat.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
});

test('P0 provider: URL externa e credenciais em URL são proibidas, opt-in vazio é offline',()=>{
  assert.equal(createLocalFiscalProvider({url:''}),null);
  assert.throws(()=>createLocalFiscalProvider({url:'https://fiscal.example.com'}),/loopback/i);
  assert.throws(()=>createLocalFiscalProvider({url:'http://user:pass@127.0.0.1:4999'}),/loopback/i);
  const provider=createLocalFiscalProvider({url:'http://127.0.0.1:4999'});
  assert.equal(provider.name,'sidecar-local');
});
