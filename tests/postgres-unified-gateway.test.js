import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresRegistryControlHandler} from '../src/platform/postgres-registry-control.js';
import {createPostgresUnifiedGateway} from '../src/platform/postgres-unified-gateway.js';

const token='T'.repeat(48),serviceToken='Z'.repeat(48);
const sessionUser={id:7,username:'alice',name:'Alice',role:'ADMIN'};
const context={
  units:[{id:2,companyId:9,role:'ADMIN',companyName:'Nova',name:'Matriz'},
    {id:3,companyId:9,role:'TECNICO',companyName:'Nova',name:'Filial'}]
};
const events=[];
const registry={
  async setupRequired(){return false;},
  async bootstrapAdmin(){throw Error('bootstrap should be blocked');},
  async login({username,password}){
    if(username!=='alice'||password!=='test-pass')
      throw Object.assign(new Error('Credenciais inválidas'),{status:401});
    return {token,user:sessionUser,expiresAt:'2030-01-01T00:00:00.000Z'};
  },
  async validateSession(value){
    if(value!==token)throw Object.assign(new Error('Sessão inválida'),{status:401});
    return sessionUser;
  },
  async logout(value){events.push(['logout',value]);return {ok:true};},
  async listUserUnits(){return context.units;},
  async isPlatformAdmin(){return true;},
  async requireUnitMembership(_userId,unitId){
    if(unitId===2)return {id:2,companyId:9,role:'ADMIN'};
    if(unitId===3)return {id:3,companyId:9,role:'TECNICO'};
    throw Object.assign(new Error('Acesso à unidade negado'),{status:403});
  }
};
function request(path,{method='GET',body,headers={}}={}){
  return new Request('http://localhost:3344'+path,{
    method,headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
}
const control=createPostgresRegistryControlHandler({registry});
test('cookie login preserved for existing browser, no bearer token in cookie response',async()=>{
 const res=await control(request('/api/auth/login',{
   method:'POST',body:{username:'alice',password:'test-pass'},
   headers:{'x-session-transport':'cookie'}
 }));
 assert.equal(res.status,200);
 assert.match(res.headers.get('set-cookie'),/^oficina_session=/);
 assert.match(res.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 assert.equal((await res.json()).token,undefined);
 const cookie=res.headers.get('set-cookie').split(';')[0];
 const me=await control(request('/api/auth/me',{
   headers:{cookie,'x-oficina-unit':'2'}
 }));
 assert.equal(me.status,200);
 assert.equal((await me.json()).role,'ADMIN');
 const noOrigin=await control(request('/api/auth/logout',{method:'POST',headers:{cookie}}));
 assert.equal(noOrigin.status,403,'cross-site cookie mutation must not pass without Origin');
 const goodOrigin=await control(request('/api/auth/logout',{method:'POST',headers:{cookie,origin:'http://localhost:3344'}}));
 assert.equal(goodOrigin.status,200);
 assert.match(goodOrigin.headers.get('set-cookie'),/Max-Age=0/);
});
test('native gateway maps browser /api routes to PostgreSQL tenant services without SQLite',async()=>{
 let selectedTenant;
 const gateway=createPostgresUnifiedGateway({registry,serviceToken,
   tenantHandlerForUnit:async unit=>{
     selectedTenant=unit;
     return async nativeRequest=>{
       const path=new URL(nativeRequest.url).pathname;
       const auth=nativeRequest.headers.get('authorization');
       if(auth!=='Bearer '+serviceToken)throw Error('missing service token');
       const body=nativeRequest.method==='POST'?await nativeRequest.json():null;
       events.push(['native',path,body,nativeRequest.headers.get('x-oficina-session')]);
       if(path==='/v1/internal/gateway-session')return Response.json({ok:true});
       if(path==='/v1/orders')return Response.json({created:true,body},{status:201});
       if(path==='/v1/dashboard')return Response.json({pg:true,companyId:unit.companyId,unitId:unit.id});
       return Response.json({error:'not found'},{status:404});
     };
   }
 });
 const r=await gateway(request('/api/work-orders',{
  method:'POST',
  headers:{authorization:'Bearer '+token,'x-oficina-unit':'2','idempotency-key':'p3-test-001'},
  body:{customerId:3,machineId:4,problemReported:'Motor',createdBy:999,unitId:999}
 }));
 assert.equal(r.status,200,'native created status should preserve legacy HTTP semantics');
 const data=await r.json();
 assert.equal(data.created,true);
 assert.equal(data.body.unitId,1,'tenant-local OS unit 1 required');
 assert.equal(data.body.createdBy,undefined,'forged actor rejected');
 assert.equal(data.body.requestId,'p3-test-001');
 assert.equal(selectedTenant.companyId,9);
 assert.equal(selectedTenant.id,2);
 assert.equal(events.filter(x=>x[0]==='native').length,2);
});
test('backend errors, missing tenant, unapproved role, missing route fail closed',async()=>{
 const gateway=createPostgresUnifiedGateway({registry,serviceToken,
   tenantHandlerForUnit:async()=>async()=>Response.json({ok:true})});
 assert.equal((await gateway(request('/api/dashboard'))).status,409);
 assert.equal((await gateway(request('/api/dashboard',{headers:{authorization:'Bearer '+token,'x-oficina-unit':'999'}}))).status,403);
 assert.equal((await gateway(request('/api/customers',{method:'POST',headers:{authorization:'Bearer '+token,'x-oficina-unit':'3'},body:{name:'Forbidden'}}))).status,403);
 assert.equal((await gateway(request('/api/unmapped',{headers:{authorization:'Bearer '+token,'x-oficina-unit':'2'}}))).status,501);
 assert.equal((await gateway(request('/v1/internal/gateway-session',{headers:{authorization:'Bearer '+token}}))).status,404);
 const failed=createPostgresUnifiedGateway({registry,serviceToken,
   tenantHandlerForUnit:async()=>{throw Error('password=do not leak')}});
 const answer=await failed(request('/api/dashboard',{headers:{authorization:'Bearer '+token,'x-oficina-unit':'2'}}));
 assert.equal(answer.status,503);
 assert.doesNotMatch(await answer.text(),/password=/);
});
test('cookie sessions reject cross-site operations and still serve read-only APIs',async()=>{
 const gateway=createPostgresUnifiedGateway({registry,serviceToken,
   tenantHandlerForUnit:async()=>async req=>Response.json({ok:new URL(req.url).pathname})});
 const cookie='oficina_session='+token;
 const read=await gateway(request('/api/dashboard',{headers:{cookie,'x-oficina-unit':'2'}}));
 assert.equal(read.status,200);
 const missingOrigin=await gateway(request('/api/work-orders',{method:'POST',body:{},
   headers:{cookie,'x-oficina-unit':'2'}}));
 assert.equal(missingOrigin.status,403);
 const cross=await gateway(request('/api/work-orders',{method:'POST',body:{},
   headers:{cookie,'x-oficina-unit':'2',origin:'https://evil.example'}}));
 assert.equal(cross.status,403);
});
