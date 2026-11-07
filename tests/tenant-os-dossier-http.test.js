import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,migrate} from '../src/db.js';
import {createUser} from '../src/auth.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder} from '../src/services/work-orders.js';
import {saveAttachment} from '../src/services/operations.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {migrateTenantRegistry,createTenantCompany,createTenantUnit} from '../src/platform/tenant-registry.js';
import {createMultiTenantServer} from '../src/platform/multi-tenant-server.js';

test('transferred OS dossier exposes original evidence to authorized administrators without duplicating files or ledger',async t=>{
  const root=mkdtempSync(join(tmpdir(),'oficina-transfer-api-'));
  const legacy=openDatabase(join(root,'legacy.sqlite'));migrate(legacy);
  const actor=createUser(legacy,{username:'transfer_admin',name:'Administrador',password:'StrongP@ss2026',role:'ADMIN'});
  const registry=openDatabase(join(root,'registry.sqlite'));
  migrateTenantRegistry(registry,legacy);
  const company=createTenantCompany(registry,actor,{slug:'dossier-source',name:'Empresa de teste'});
  const target=createTenantUnit(registry,actor,{companyId:company.id,code:'NORTE',name:'Filial norte'});
  const dir=join(root,'tenants','company-'+company.id,'unit-'+company.unitId);
  mkdirSync(dir,{recursive:true});
  const sourceDb=openDatabase(join(dir,'oficina.sqlite'));migrate(sourceDb);migrateAssistencia(sourceDb);
  const customer=createCustomer(sourceDb,{name:'Cliente da oficina'});
  const machine=createMachine(sourceDb,{customerId:customer.id,type:'AUTOMOVEL'});
  const os=createWorkOrder(sourceDb,{customerId:customer.id,machineId:machine.id,problemReported:'Diagnóstico'});
  const evidence=Buffer.from('original evidence bytes');
  const attachment=saveAttachment(sourceDb,os.id,{category:'DIAGNOSTICO',mimeType:'application/pdf',
    originalName:'prova.pdf',base64:evidence.toString('base64'),
    storageDir:join(dir,'uploads')});
  const authorizedXml='<nfeProc><NFe>authorized-origin-only</NFe></nfeProc>';
  const fiscalDoc=sourceDb.prepare(`INSERT INTO fiscal_documents(
    kind,origin_type,origin_id,status,amount_cents,snapshot_json,snapshot_hash,
    request_id,authorized_xml,created_at,updated_at
  ) VALUES ('NFE','OS',?,'AUTORIZADA',15000,'{}','test-hash',
    'dossier-origin-xml',?,'2026-11-03T00:00:00.000Z','2026-11-03T00:00:00.000Z')`)
    .run(os.id,authorizedXml);
  const fiscalId=Number(fiscalDoc.lastInsertRowid);
  const server=createMultiTenantServer({
    registryDb:registry,legacyDb:legacy,tenantsRoot:join(root,'tenants'),
    legacyStorageDir:join(root,'legacy-uploads')
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    sourceDb.close();registry.close();legacy.close();
    rmSync(root,{recursive:true,force:true});
  });
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,{method='GET',body,token,binary=false}={})=>{
    const response=await fetch(base+path,{method,headers:{
      ...(body?{'Content-Type':'application/json'}:{}),
      ...(token?{'Authorization':'Bearer '+token}:{})
    },body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:binary?Buffer.from(await response.arrayBuffer()):await response.json()};
  };
  const login=await request('/api/auth/login',{method:'POST',body:{
    username:'transfer_admin',password:'StrongP@ss2026'
  }});
  assert.equal(login.status,200);
  const token=login.body.token;
  const moved=await request('/api/tenancy/os-transfer',{method:'POST',token,body:{
    sourceUnitId:company.unitId,targetUnitId:target.id,workOrderId:os.id,
    legalBasis:'CONTRATO',recordReference:'OS-TRANSFER-DOSSIE-2026',
    requestId:'dossier-os-001'
  }});
  assert.equal(moved.status,200,JSON.stringify(moved.body));
  const url='/api/tenancy/os-transfer/'+moved.body.transferId+'/dossier';
  assert.equal((await request(url)).status,401);
  const dossier=await request(url,{token});
  assert.equal(dossier.status,200);
  assert.equal(dossier.body.authoritativeLedgers,'ORIGIN');
  assert.equal(dossier.body.attachments[0].id,attachment.id);
  const file='/api/tenancy/os-transfer/'+moved.body.transferId+'/attachments/'+attachment.id+'/file';
  assert.equal((await request(file,{binary:true})).status,401);
  const downloaded=await request(file,{token,binary:true});
  assert.equal(downloaded.status,200);
  assert.deepEqual(downloaded.body,evidence);
  assert.equal((await request(file.replace('/'+attachment.id+'/file','/9999/file'),{token,binary:true})).status,404);
  const xmlUrl='/api/tenancy/os-transfer/'+moved.body.transferId+'/fiscal/'+fiscalId+'/xml';
  assert.equal((await request(xmlUrl,{binary:true})).status,401);
  const xml=await request(xmlUrl,{token,binary:true});
  assert.equal(xml.status,410,'o download fiscal integrado está desativado');
  assert.equal((await request(xmlUrl.replace('/'+fiscalId+'/xml','/999999/xml'),{token,binary:true})).status,410);
  assert.equal(sourceDb.prepare('SELECT COUNT(*) n FROM fiscal_documents').get().n,1);

  const received=await request('/api/work-orders',{token,method:'GET'});
  assert.equal(received.status,409,'unit selection remains compulsory');
});
