import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createD1Port} from '../src/platform/async-sql-ports.js';
import {migrateAsyncTenantStore} from '../src/platform/async-tenant-migrations.js';
import {createAsyncWorkshopFiscal} from '../src/platform/async-workshop-fiscal.js';

const key='35111122233300018155001000000011000000001000';
const xml='<nfeProc><NFe><infNFe Id="NFe'+key+'"><ide><tpAmb>2</tpAmb></ide>'+
  '<emit><CNPJ>11222333000181</CNPJ></emit></infNFe></NFe>'+
  '<protNFe><infProt><cStat>100</cStat><chNFe>'+key+'</chNFe>'+
  '<nProt>1234567890</nProt></infProt></protNFe></nfeProc>';
const issuer={issuerCnpj:'11222333000181',issuerUf:'SP',municipalityIbge:'3550308',
  taxRegime:'SIMPLES',stateRegistration:'123',municipalRegistration:'456',enabled:true};
function portFor(db){
  return createD1Port({binding:{
    prepare(sql){return {bind(...values){return {
      async first(){return db.prepare(sql).get(...values);},
      async all(){return {results:db.prepare(sql).all(...values)};},
      async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:result.changes}};}
    }}}},
    async batch(statements){
      db.exec('BEGIN IMMEDIATE');
      try{
        const responses=[];
        for(const statement of statements)responses.push(await statement.run());
        db.exec('COMMIT');
        return responses;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  }});
}
async function draft(port,id,environment,kind='NFE'){
  const snapshot=JSON.stringify({originNumber:id,lines:[{description:'Filtro'}]});
  const hash=createHash('sha256').update(snapshot).digest('hex');
  await port.run(`INSERT INTO fiscal_documents(
    id,kind,origin_type,origin_id,status,amount_cents,snapshot_json,snapshot_hash,
    request_id,environment,created_at,updated_at
  ) VALUES(?,?,?,?,'RASCUNHO',?,?,?,?,?,?,?)`,
  [id,kind,'OS',id,500,snapshot,hash,'fiscal-'+id,environment,
    '2026-11-05T12:00:00Z','2026-11-05T12:00:00Z']);
}
test('D1 canonical: emitir em homologação grava evidência; produção exige a mesma prova',async()=>{
  const db=openDatabase(':memory:');
  try{
    const port=portFor(db);
    await migrateAsyncTenantStore(port);
    let identity='a'.repeat(64),transmissions=0;
    const provider={
      name:'acbrlib-local',
      certificateStatus:()=>({configured:true,certificateType:'A1'}),
      certificateIdentity:()=>identity,
      async prepare(){},
      async transmit({document}){
        transmissions++;
        return {status:'AUTORIZADA',environment:document.environment,accessKey:key,
          protocol:'1234567890',number:String(document.id),series:'1',
          xml:document.environment==='HOMOLOGACAO'?xml:'<nfeProc>produção autorizada</nfeProc>'};
      }
    };
    const fiscal=createAsyncWorkshopFiscal(port,{provider});
    await fiscal.setFiscalSettings({...issuer,environment:'PRODUCAO',productionConfirmed:true});
    await draft(port,50,'PRODUCAO');
    await assert.rejects(fiscal.submitFiscalDocument(50),/homologação|não liberada/i);
    assert.equal(transmissions,0);
    assert.equal((await fiscal.getFiscalDocument(50)).status,'RASCUNHO');
    await fiscal.setFiscalSettings({environment:'HOMOLOGACAO',productionConfirmed:false});
    await draft(port,51,'HOMOLOGACAO');
    const approved=await fiscal.submitFiscalDocument(51);
    assert.equal(approved.status,'AUTORIZADA_HOMOLOGACAO');
    assert.equal((await port.first('SELECT COUNT(*) n FROM fiscal_homologation_evidence')).n,1);
    const restarted=createAsyncWorkshopFiscal(port,{provider});
    const homol=await restarted.getFiscalOnboardingStatus();
    assert.equal(homol.models.NFE.homologationVerified,true);
    assert.equal(homol.models.NFE.productionReady,false);
    await restarted.setFiscalSettings({environment:'PRODUCAO',productionConfirmed:true});
    const ready=await restarted.getFiscalOnboardingStatus();
    assert.equal(ready.models.NFE.productionReady,true);
    assert.equal(ready.models.NFCE.productionReady,false);
    await draft(port,52,'PRODUCAO','NFCE');
    await assert.rejects(restarted.submitFiscalDocument(52),/não liberada|homologação/i);
    assert.equal(transmissions,1);
    assert.equal((await restarted.submitFiscalDocument(50)).status,'AUTORIZADA');
    assert.equal(transmissions,2);
    identity='b'.repeat(64);
    const rotated=await restarted.getFiscalOnboardingStatus();
    assert.equal(rotated.models.NFE.productionReady,false);
    identity='a'.repeat(64);
    await restarted.setFiscalSettings({taxRegime:'NORMAL'});
    const changed=await restarted.getFiscalOnboardingStatus();
    assert.equal(changed.models.NFE.productionReady,false);
  }finally{db.close();}
});
test('D1 canonical: outra unidade sem prova não herda autorização da primeira',async()=>{
  const db=openDatabase(':memory:');
  try{
    const port=portFor(db);
    await migrateAsyncTenantStore(port);
    const fiscal=createAsyncWorkshopFiscal(port,{provider:{
      name:'acbrlib-local',certificateStatus:()=>({configured:true}),
      certificateIdentity:()=> 'a'.repeat(64),transmit:async()=>{throw Error('Não transmitir');}
    }});
    await fiscal.setFiscalSettings({...issuer,environment:'PRODUCAO',productionConfirmed:true});
    const state=await fiscal.getFiscalOnboardingStatus();
    assert.equal(state.models.NFE.productionReady,false);
    assert.equal(state.productionReady,false);
  }finally{db.close();}
});
