import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenantFiscalProvider, validateTenantFiscalConfigs } from '../src/platform/tenant-fiscal.js';

test('tenant fiscal provider disabled by default outside configured company',()=>{
  assert.equal(resolveTenantFiscalProvider({companyId:2,configs:{},providers:{sidecar:()=>({})}}),null);
});
test('a company fiscal connector cannot send with an issuer CNPJ from another tenant',async()=>{
  const calls=[];
  const configs={'2':{type:'sidecar',url:'http://127.0.0.1:4102',cnpj:'11222333000181'},
    '3':{type:'sidecar',url:'http://127.0.0.1:4103',cnpj:'11444777000161'}};
  const providers={sidecar:cfg=>({
    name:'fake-'+cfg.url,
    async transmit(payload){calls.push({url:cfg.url,payload});return {status:'INDETERMINADO'};},
    async consult(payload){calls.push({url:cfg.url,payload});return {status:'INDETERMINADO'};}
  })};
  const a=resolveTenantFiscalProvider({companyId:2,configs,providers});
  const b=resolveTenantFiscalProvider({companyId:3,configs,providers});
  await assert.rejects(a.transmit({document:{issuer_snapshot_json:JSON.stringify({cnpj:'11444777000161'})}}),/CNPJ/);
  assert.equal(calls.length,0);
  await a.transmit({document:{issuer_snapshot_json:JSON.stringify({cnpj:'11222333000181'})}});
  await b.consult({document:{issuer_snapshot_json:JSON.stringify({cnpj:'11444777000161'})}});
  assert.deepEqual(calls.map(v=>v.url),['http://127.0.0.1:4102','http://127.0.0.1:4103']);
});
test('fiscal config rejects ambiguous or incomplete tenant mappings',()=>{
  assert.throws(()=>validateTenantFiscalConfigs({'2':{type:'sidecar',url:'http://127.0.0.1:4102'}}),/CNPJ/);
  assert.throws(()=>validateTenantFiscalConfigs({'2':{type:'sidecar',url:'https://remote.example',cnpj:'11222333000181'}}),/loopback/i);
  assert.throws(()=>validateTenantFiscalConfigs({'2':{type:'acbr',cnpj:'11222333000181'}}),/ACBr/);
  assert.throws(()=>validateTenantFiscalConfigs({'2':{type:'sidecar',url:'http://127.0.0.1:4102',cnpj:'11222333000181'},'3':{type:'sidecar',url:'http://127.0.0.1:4103',cnpj:'11222333000181'}}),/CNPJ.*duplicado/);
});

test('tenant fiscal binds NFS-e channel to company and municipality without fallback',()=>{
 const cfg={'2':{type:'sidecar',url:'http://127.0.0.1:4102',cnpj:'11222333000181',
   nfseChannel:'MUNICIPAL',nfseMunicipalityIbge:'4128104'}};
 const provider=resolveTenantFiscalProvider({companyId:2,configs:cfg,providers:{sidecar:()=>({
   name:'mock-local',async transmit(){return {status:'INDETERMINADO'};},async consult(){return {status:'INDETERMINADO'};}
 })}});
 assert.equal(provider.nfseChannel,'MUNICIPAL');
 assert.equal(provider.nfseMunicipalityIbge,'4128104');
 assert.throws(()=>validateTenantFiscalConfigs({'2':{...cfg['2'],nfseChannel:'AUTO'}}),/Canal NFS-e/);
 assert.throws(()=>validateTenantFiscalConfigs({'2':{...cfg['2'],nfseMunicipalityIbge:'999'}}),/município IBGE/);
});
