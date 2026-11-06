import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOficinaCommercialLicense} from '../src/platform/commercial-license.js';
import {createPostgresUnifiedGateway} from '../src/platform/postgres-unified-gateway.js';

test('core R$0 não exige licença nem acessa Cloudflare',async()=>{
 const license=createOficinaCommercialLicense({required:false,fetchImpl:()=>{throw Error('não chamar rede')}});
 assert.deepEqual(await license.status(),{required:false,active:true,offline:false});
 await assert.rejects(()=>license.activate({email:'a@b.com',code:'123456'}),/não habilitado/i);
});

test('ativação Oficina isola produto e preserva uso offline após confirmação',async t=>{
 const root=await mkdtemp(join(tmpdir(),'oficina-license-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const calls=[];let online=true,remoteActive=true;
 const fetchImpl=async(url,init)=>{
  if(!online)throw Error('sem rede');
  calls.push({url:String(url),body:init?.body?JSON.parse(init.body):null});
  if(String(url).includes('/activation/verify'))return Response.json({
    licenseId:'license-oficina-1',accountEmail:'cliente@example.com',product:'OFICINA',
    expiresAt:'2030-01-01T00:00:00.000Z',activatedAt:'2026-11-05T00:00:00.000Z'
  });
  return Response.json({active:remoteActive,product:'OFICINA',expiresAt:'2030-01-01T00:00:00.000Z'});
 };
 let current=Date.parse('2026-11-05T12:00:00.000Z');
 const license=createOficinaCommercialLicense({required:true,root,endpoint:'https://licenca.example.test',fetchImpl,now:()=>current});
 assert.equal((await license.status()).active,false);
 await assert.rejects(()=>license.activate({email:'cliente@example.com',code:'12'}),/código/i);
 const activated=await license.activate({email:'cliente@example.com',code:'123456'});
 assert.equal(activated.active,true);
 assert.equal(calls[0].body.product,'OFICINA');
 assert.match(calls[0].body.installationId,/^oficina-/);
 online=false;current+=86400000;
 assert.equal((await license.status()).active,true);
 assert.equal((await license.status()).offline,true);
 online=true;remoteActive=false;current+=86400000;
 assert.equal((await license.status()).active,false);
 online=false;current+=86400000;
 assert.equal((await license.status()).active,false,'revogada não pode voltar a funcionar offline');
 online=true;remoteActive=true;current+=86400000;
 assert.equal((await license.status()).active,true,'revalidação reconhece licença reativada na Central');
});

test('API bloqueia setup/login no modo comercial não ativado sem afetar edição livre',async()=>{
 let active=false,bootstraps=0;
 const registry={
  async setupRequired(){return true;},
  async bootstrapAdmin(){bootstraps++;return {ok:true};},
  async validateSession(){throw Object.assign(Error('Sem sessão'),{status:401});},
  async requireUnitMembership(){throw Error('não chamar');},
  async listUserUnits(){return [];}
 };
 const gateway=createPostgresUnifiedGateway({
  registry,tenantHandlerForUnit:async()=>{throw Error('não chamar')},
  serviceToken:'x'.repeat(48),allowAdminBootstrap:true,
  licenseControl:{required:true,status:async()=>({required:true,active}),activate:async()=>{active=true;return {required:true,active:true}}}
 });
 const req=(p,method='GET',body)=>new Request('http://localhost:3344'+p,{
  method,headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})
 });
 assert.equal((await gateway(req('/api/license/status'))).status,200);
 assert.equal((await gateway(req('/api/setup/status'))).status,200);
 assert.equal((await gateway(req('/api/setup/initialize','POST',{username:'admin'}))).status,403);
 assert.equal((await gateway(req('/api/auth/login','POST',{username:'admin'}))).status,403);
 assert.equal(bootstraps,0);
 assert.equal((await gateway(req('/api/license/activate','POST',{email:'a@b.com',code:'123456'}))).status,200);
 assert.equal((await gateway(req('/api/setup/initialize','POST',{username:'admin'}))).status,200);
 assert.equal(bootstraps,1);
});

test('resposta de licença de outro produto não autoriza Oficina offline',async t=>{
 const root=await mkdtemp(join(tmpdir(),'oficina-license-isolation-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 let statusProduct='OFICINA';
 let current=Date.parse('2026-11-05T12:00:00.000Z');
 const license=createOficinaCommercialLicense({
  required:true,root,endpoint:'https://licenca.example.test',now:()=>current,
  fetchImpl:async url=>{
   if(String(url).includes('/activation/verify'))return Response.json({
    licenseId:'lic-1',product:'OFICINA',accountEmail:'pessoa@example.com',
    expiresAt:null,activatedAt:'2026-11-05T12:00:00.000Z'
   });
   return Response.json({product:statusProduct,active:true,expiresAt:null});
  }
 });
 assert.equal((await license.activate({email:'pessoa@example.com',code:'123456'})).active,true);
 statusProduct='PDV';current+=16*60*1000;
 assert.equal((await license.status()).active,false);
});
