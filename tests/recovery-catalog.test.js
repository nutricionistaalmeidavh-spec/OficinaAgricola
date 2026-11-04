import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecoveryCatalog} from '../src/platform/recovery-catalog.js';
const time='2026-11-04T13:00:00.000Z';
const registryUnits=[{id:1,company_id:1},{id:2,company_id:1},{id:3,company_id:2}];
const archives=[1,2,3].map(id=>({unitId:id,companyId:id===3?2:1,archivePath:'/staging/'+id,
 manifest:{version:1,createdAt:time,files:[{path:'database.sqlite'}]}}));
test('multi-tenant restore requires a full verified inventory for every unit',()=>{
 const result=validateRecoveryCatalog({registryUnits,registryManifest:{version:1,createdAt:time},unitArchives:archives});
 assert.equal(result.unitCount,3);
 assert.deepEqual(result.units.map(u=>u.unitId),[1,2,3]);
 assert.equal(result.requiresStoppedService,true);
});
test('recovery inventory rejects missing, duplicate and cross-company tenant archives',()=>{
 const base={registryUnits,registryManifest:{version:1,createdAt:time}};
 assert.throws(()=>validateRecoveryCatalog({...base,unitArchives:archives.slice(0,2)}),/ausente/);
 assert.throws(()=>validateRecoveryCatalog({...base,unitArchives:[...archives,archives[0]]}),/duplicado/);
 assert.throws(()=>validateRecoveryCatalog({...base,unitArchives:[archives[0],{...archives[1],companyId:2},archives[2]]}),/empresa/);
});
test('recovery inventory rejects stale snapshots, unknown units and reused files',()=>{
 const base={registryUnits,registryManifest:{version:1,createdAt:time}};
 assert.throws(()=>validateRecoveryCatalog({...base,unitArchives:[{...archives[0],manifest:{...archives[0].manifest,createdAt:'2026-11-03T11:00:00.000Z'}},...archives.slice(1)]}),/temporal/);
 assert.throws(()=>validateRecoveryCatalog({...base,unitArchives:[...archives,{unitId:4,companyId:1,archivePath:'/staging/4',manifest:{version:1,createdAt:time}}]}),/desconhecida/);
 assert.throws(()=>validateRecoveryCatalog({...base,unitArchives:[archives[0],{...archives[1],archivePath:archives[0].archivePath},archives[2]]}),/mesmo arquivo/);
});
