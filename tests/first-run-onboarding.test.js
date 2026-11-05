import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {ONBOARDING_TABLE_DDL} from '../src/platform/async-tenant-extra-schema.js';
import {createAsyncWorkshopOnboarding} from '../src/platform/async-workshop-onboarding.js';
import {mapLegacyNativeRoute} from '../src/platform/native-api-route-map.js';
import {requiredNativeRoles} from '../src/platform/async-workshop-policy.js';

function setup(){
 const db=openDatabase(':memory:');
 migrate(db);migrateAssistencia(db);db.exec(ONBOARDING_TABLE_DDL);
 const port=createCommonDataAdapter({engine:'sqlite',db});
 const service=()=>createAsyncWorkshopOnboarding(port,{
   certificateStatus:()=>({configured:false,certificateType:null})
 });
 return {db,service};
}

test('primeiro acesso não libera operação sem empresa e não bloqueia por fiscal',async()=>{
 const {db,service}=setup();
 try{
   const onboarding=service();
   const initial=await onboarding.getStatus();
   assert.equal(initial.readyToWork,false);
   assert.equal(initial.finished,false);
   assert.equal(initial.fiscalState,'PENDENTE');
   assert.equal(initial.steps.find(step=>step.key==='company').complete,false);
   await assert.rejects(onboarding.setPreference({action:'finish'}),/empresa/i);
   db.prepare('UPDATE company_settings SET name=?,address=? WHERE id=1')
     .run('Oficina Exemplo','Rua Central, 10');
   const updated=await onboarding.getStatus();
   assert.equal(updated.readyToWork,true);
   assert.equal(updated.fiscalState,'PENDENTE');
   assert.equal(updated.steps.find(step=>step.key==='company').complete,true);
   await onboarding.setPreference({action:'finish'});
   assert.equal((await service().getStatus()).finished,true);
 }finally{db.close();}
});

test('etapas opcionais persistem na unidade e não podem falsificar prontidão fiscal',async()=>{
 const {db,service}=setup();
 try{
   const onboarding=service();
   await onboarding.setPreference({action:'skip',step:'fiscal'});
   await onboarding.setPreference({action:'confirm',step:'printer'});
   const resumed=await service().getStatus();
   assert.equal(resumed.steps.find(step=>step.key==='fiscal').skipped,true);
   assert.equal(resumed.steps.find(step=>step.key==='printer').complete,true);
   await assert.rejects(onboarding.setPreference({action:'confirm',step:'fiscal'}),/etapa/i);
   await assert.rejects(onboarding.setPreference({action:'skip',step:'company'}),/obrigat/i);
   await onboarding.setPreference({action:'resume',step:'fiscal'});
   assert.equal((await onboarding.getStatus()).steps.find(step=>step.key==='fiscal').skipped,false);
 }finally{db.close();}
});

test('diagnóstico é informativo e não registra homologação nem autoriza produção',async()=>{
 const {db,service}=setup();
 try{
   const diagnostics=await service().runDiagnostics();
   assert.equal(diagnostics.database.ok,true);
   assert.equal(diagnostics.fiscal.authorizedForProduction,false);
   assert.equal(diagnostics.fiscal.homologationVerified,false);
 }finally{db.close();}
});

test('rotas do primeiro acesso exigem sessão e ADMIN para alteração',()=>{
 assert.deepEqual(mapLegacyNativeRoute('GET','/api/onboarding')?.roles,['ADMIN']);
 assert.deepEqual(mapLegacyNativeRoute('PATCH','/api/onboarding')?.roles,['ADMIN']);
 assert.deepEqual(mapLegacyNativeRoute('GET','/api/onboarding/diagnostics')?.roles,['ADMIN']);
 assert.deepEqual(requiredNativeRoles('PATCH','/v1/onboarding'),['ADMIN']);
 assert.deepEqual(requiredNativeRoles('GET','/v1/onboarding'),['ADMIN']);
});
