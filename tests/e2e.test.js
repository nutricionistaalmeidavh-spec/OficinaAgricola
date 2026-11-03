import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { seedDefaultChecklists } from '../src/services/operations.js';
import { createAppServer } from '../src/server.js';

async function request(base,path,{method='GET',token,body,raw=false}={}){
  const headers={}; if(token)headers.Authorization=`Bearer ${token}`; if(body!==undefined)headers['Content-Type']='application/json';
  const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await res.text(); const data=raw?text:(text?JSON.parse(text):null);
  if(!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`); return data;
}

test('critical workshop flow works end-to-end through HTTP API', async (t)=>{
  const db=openDatabase(':memory:'); migrate(db); seedDefaultChecklists(db); createUser(db,{username:'admin',password:'Admin@1234',role:'ADMIN',name:'Administrador'});
  const app=createAppServer({db,storageDir:'/tmp/oficina-e2e-uploads'}); await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>{app.close();db.close()}); const address=app.address(); const base=`http://127.0.0.1:${address.port}`;

  assert.deepEqual(await request(base,'/api/health'),{ok:true});
  const auth=await request(base,'/api/auth/login',{method:'POST',body:{username:'admin',password:'Admin@1234'}}); const token=auth.token;
  const customer=await request(base,'/api/customers',{method:'POST',token,body:{name:'Fazenda Santa Clara',phone:'16999999999'}});
  const machine=await request(base,'/api/machines',{method:'POST',token,body:{customerId:customer.id,type:'Trator',brand:'John Deere',model:'6175M',hourMeter:950}});
  const tech=await request(base,'/api/technicians',{method:'POST',token,body:{name:'Carlos',specialty:'Hidráulica'}});
  let os=await request(base,'/api/work-orders',{method:'POST',token,body:{customerId:customer.id,machineId:machine.id,technicianId:tech.id,problemReported:'Vazamento hidráulico'}});
  os=await request(base,`/api/work-orders/${os.id}`,{method:'PATCH',token,body:{diagnosis:'Vedação da bomba danificada'}});
  await request(base,`/api/work-orders/${os.id}/status`,{method:'POST',token,body:{status:'DIAGNOSTICO'}});
  await request(base,`/api/work-orders/${os.id}/quote`,{method:'PUT',token,body:{items:[{kind:'MAO_DE_OBRA',description:'Reparo hidráulico',quantity:1,unitPriceCents:20000}]}});
  await request(base,`/api/work-orders/${os.id}/quote/approve`,{method:'POST',token,body:{}});
  const part=await request(base,'/api/parts',{method:'POST',token,body:{sku:'VED-01',description:'Kit de vedação',salePriceCents:8000,minStock:1}});
  await request(base,'/api/inventory/movements',{method:'POST',token,body:{partId:part.id,type:'ENTRADA',quantity:3}});
  await request(base,`/api/work-orders/${os.id}/parts`,{method:'POST',token,body:{partId:part.id,quantity:1}});
  const templates=await request(base,'/api/checklist-templates',{token}); const entry=templates.find(x=>x.kind==='ENTRADA');
  await request(base,`/api/work-orders/${os.id}/checklists`,{method:'POST',token,body:{templateId:entry.id,responses:[{position:1,response:'OK'}]}});
  await request(base,`/api/work-orders/${os.id}/attachments`,{method:'POST',token,body:{category:'DIAGNOSTICO',caption:'Bomba',originalName:'bomba.jpg',mimeType:'image/jpeg',base64:Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64')}});
  const attachments=await request(base,`/api/work-orders/${os.id}/attachments`,{token}); assert.equal(attachments.length,1);
  const file=await request(base,`/api/attachments/${attachments[0].id}/file`,{token,raw:true}); assert.equal(file,'foto');
  await request(base,`/api/work-orders/${os.id}/status`,{method:'POST',token,body:{status:'EM_SERVICO'}});
  await request(base,`/api/work-orders/${os.id}/status`,{method:'POST',token,body:{status:'PRONTA'}});
  const pay=await request(base,`/api/work-orders/${os.id}/receipts`,{method:'POST',token,body:{amountCents:20000,method:'PIX'}}); assert.equal(pay.amount_cents,20000);
  await request(base,`/api/work-orders/${os.id}/status`,{method:'POST',token,body:{status:'ENTREGUE'}});
  const history=await request(base,`/api/machines/${machine.id}/history`,{token}); assert.equal(history[0].status,'ENTREGUE');
  const doc=await request(base,`/api/work-orders/${os.id}/documents/work-order`,{token,raw:true}); assert.match(doc,/Ordem de Serviço/);
  const dashboard=await request(base,'/api/dashboard',{token}); assert.ok('counts' in dashboard); assert.equal(dashboard.lowStock.length>=0,true);
});
