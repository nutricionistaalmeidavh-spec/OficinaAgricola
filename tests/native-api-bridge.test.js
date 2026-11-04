import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeApiBridge} from '../src/platform/native-api-bridge.js';

test('bridge provisions per-tenant user session and forwards only internal credentials',async()=>{
 const seen=[],serviceToken='T'.repeat(48),globalToken='G'.repeat(43);
 const fetchImpl=async(url,options)=>{
  seen.push({url:String(url),headers:options.headers,body:options.body});
  return Response.json(seen.length===1?{ok:true}:{id:4,name:'Cliente'},{
   status:seen.length===1?200:201});
 };
 const bridge=createNativeApiBridge({fetchImpl});
 const backend={endpoint:'http://127.0.0.1:3456',serviceToken,companyId:5,unitId:8};
 const result=await bridge({
  backend,unit:{id:8,companyId:5,role:'ATENDIMENTO'},user:{id:12,name:'Atendente'},
  globalToken,expiresAt:new Date(Date.now()+3600000).toISOString(),
  method:'POST',path:'/api/customers',body:{name:'Cliente'}
 });
 assert.equal(result.status,200,'legacy API retains successful mutation envelope');
 assert.deepEqual(result.body,{id:4,name:'Cliente'});
 assert.match(seen[0].url,/\/v1\/internal\/gateway-session$/);
 assert.match(seen[1].url,/\/v1\/customers$/);
 assert.equal(seen[1].headers.authorization,'Bearer '+serviceToken);
 assert.ok(seen[1].headers['x-oficina-session']);
 assert.ok(!seen[1].headers['x-oficina-session'].includes(globalToken));
 assert.equal(JSON.stringify(seen).includes(globalToken),false,'global cookie must never reach native backend');
});
test('bridge rejects unknown tenant, foreign endpoint and unsupported routes without making requests',async()=>{
 let calls=0;
 const bridge=createNativeApiBridge({fetchImpl:async()=>{calls++;return Response.json({ok:true});}});
 const common={unit:{id:2,companyId:3,role:'ADMIN'},user:{id:1,name:'Admin'},
  globalToken:'G'.repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString(),
  method:'GET',path:'/api/customers'};
 const valid={endpoint:'http://127.0.0.1:3456',serviceToken:'t'.repeat(40),companyId:3,unitId:2};
 await assert.rejects(bridge({...common,backend:{...valid,companyId:7}}),/identidade|tenant|unidade/i);
 await assert.rejects(bridge({...common,backend:{...valid,endpoint:'http://foreign.example:3456'}}),/HTTPS|loopback/i);
 await assert.rejects(bridge({...common,backend:valid,path:'/api/diagnostics/hardware'}),/não suportada|disponível/i);
 await assert.rejects(bridge({...common,backend:valid,unit:{...common.unit,role:'TECNICO'},method:'POST'}),/Permissão/i);
 assert.equal(calls,0);
});


test('native bridge never follows redirects with private service or user headers',async()=>{
 const hits=[];
 const bridge=createNativeApiBridge({fetchImpl:async(url,options)=>{
  hits.push({url:String(url),options});
  if(String(url).endsWith('/v1/internal/gateway-session'))return Response.json({ok:true});
  return new Response(null,{status:302,headers:{location:'https://third-party.invalid/collect'}});
 }});
 const backend={endpoint:'http://127.0.0.1:3456',serviceToken:'s'.repeat(40),companyId:1,unitId:2};
 await assert.rejects(bridge({backend,unit:{id:2,companyId:1,role:'ADMIN'},
  user:{id:10,name:'Admin'},globalToken:'z'.repeat(43),
  expiresAt:new Date(Date.now()+1800000).toISOString(),method:'GET',path:'/api/customers'
 }),/redirecionamento|redirecion|backend/i);
 assert.equal(hits.length,2);
 assert.equal(hits.every(x=>x.options.redirect==='manual'),true);
});
