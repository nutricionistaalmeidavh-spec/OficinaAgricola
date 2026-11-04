import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// The default is ALWAYS SQLite. Native units require explicit, reviewed
// operator configuration and a separate, verified data migration.
export function loadNativeTenantBackends(configFile,{...env}=process.env){
 if(configFile==null||configFile==='')return ()=>null;
 if(env.TENANCY_NATIVE_CUTOVER_APPROVED!=='true')
  throw Error('Roteamento PostgreSQL/D1 requer aprovação explícita do cutover auditado');
 let rows;
 try{rows=JSON.parse(readFileSync(resolve(configFile),'utf8'));}
 catch(error){throw Error('Configuração de backends nativos inválida: '+error.message);}
 if(!Array.isArray(rows)||!rows.length)throw Error('Catálogo de unidades nativas vazio');
 const entries=new Map();
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Unidade nativa inválida');
  if('serviceToken' in row||'accessKey' in row||'secret' in row)
   throw Error('Nunca incluir credenciais ou secrets no catálogo JSON');
  const companyId=Number(row.companyId),unitId=Number(row.unitId);
  if(!Number.isSafeInteger(companyId)||companyId<1||
     !Number.isSafeInteger(unitId)||unitId<1)
   throw Error('Identidade de unidade nativa inválida');
  if(typeof row.serviceTokenEnv!=='string'||
     !/^OFICINA_NATIVE_[A-Z0-9_]+$/.test(row.serviceTokenEnv))
   throw Error('Variável de ambiente de token nativo inválida');
  const serviceToken=env[row.serviceTokenEnv];
  if(typeof serviceToken!=='string'||serviceToken.length<32)
   throw Error('Token privado do backend nativo ausente no ambiente');
  if(typeof row.endpoint!=='string'||!row.endpoint.trim())
   throw Error('Endpoint nativo obrigatório');
  const key=companyId+'/'+unitId;
  if(entries.has(key))throw Error('Unidade nativa duplicada no catálogo');
  entries.set(key,Object.freeze({companyId,unitId,
   endpoint:row.endpoint,serviceToken}));
 }
 return unit=>entries.get(Number(unit?.companyId)+'/'+Number(unit?.id))??null;
}
