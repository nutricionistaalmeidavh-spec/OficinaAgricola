import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createAppServer} from '../src/server.js';
async function req(base,path,{method='GET',token,body}={}){
 const headers={};if(token)headers.Authorization='Bearer '+token;
 if(body)headers['Content-Type']='application/json';
 const res=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
 return {status:res.status,data:await res.json()};
}
test('P1/P2/P3 HTTP: public approval is token-protected; CRM and units require roles',async t=>{
 const db=openDatabase(':memory:');migrate(db);
 createUser(db,{username:'admin',password:'Admin@1234',name:'Admin',role:'ADMIN'});
 createUser(db,{username:'tech',password:'Tecnico@1234',name:'Técnico',role:'TECNICO'});
 const server=createAppServer({db});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const admin=(await req(base,'/api/auth/login',{method:'POST',body:{username:'admin',password:'Admin@1234'}})).data.token;
 const tech=(await req(base,'/api/auth/login',{method:'POST',body:{username:'tech',password:'Tecnico@1234'}})).data.token;
 const c=(await req(base,'/api/customers',{method:'POST',token:admin,body:{name:'Cliente HTTP'}})).data;
 const m=(await req(base,'/api/machines',{method:'POST',token:admin,body:{customerId:c.id,type:'Carro',plate:'ABC1D23'}})).data;
 const os=(await req(base,'/api/work-orders',{method:'POST',token:admin,body:{customerId:c.id,machineId:m.id,problemReported:'Revisão'}})).data;
 assert.equal((await req(base,'/api/vehicles/plate/ABC1D23',{token:admin})).data.id,m.id);
 assert.equal((await req(base,'/api/crm/tasks',{method:'POST',token:tech,body:{customerId:c.id,title:'Não autorizado'}})).status,403);
 assert.equal((await req(base,'/api/units',{method:'POST',token:tech,body:{code:'FILIAL',name:'Filial'}})).status,403);
 const unit=(await req(base,'/api/units',{method:'POST',token:admin,body:{code:'FILIAL',name:'Filial'}})).data;
 assert.equal((await req(base,'/api/units/assign',{method:'POST',token:admin,body:{workOrderId:os.id,unitId:unit.id}})).status,200);
 const first=(await req(base,'/api/work-orders/'+os.id,{token:admin})).data;
 await req(base,'/api/work-orders/'+os.id+'/status',{method:'POST',token:admin,body:{status:'DIAGNOSTICO',expectedVersion:first.version}});
 assert.equal((await req(base,'/api/work-orders/'+os.id+'/quote',{method:'PUT',token:admin,body:{items:[{kind:'MAO_DE_OBRA',description:'Serviço',quantity:1,unitPriceCents:10000}]}})).status,200);
 assert.equal((await req(base,'/api/work-orders/'+os.id+'/quote/submit',{method:'POST',token:admin,body:{}})).status,200);
 const link=(await req(base,'/api/work-orders/'+os.id+'/quote/approval-link',{method:'POST',token:admin,body:{expiresInHours:24}})).data;
 assert.equal((await req(base,'/api/public/approval/'+link.token)).data.totalCents,10000);
 assert.equal((await req(base,'/api/public/approval/bad')).status,400);
 assert.equal((await req(base,'/api/public/approval/'+link.token,{method:'POST',body:{decision:'APROVAR'}})).data.status,'APROVADO');
 assert.equal((await req(base,'/api/work-orders/'+os.id,{token:admin})).data.status,'APROVADA');
});
