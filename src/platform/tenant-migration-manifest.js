import {createHash} from 'node:crypto';
import {asyncTenantSchema} from './async-tenant-migrations.js';

// Read-only migration preflight. No service switches database automatically.
// Snapshot must be taken with writers stopped; source remains authoritative
// until imported data and attachments have been verified separately.
const canonicalNames=Object.freeze(
 asyncTenantSchema('d1')
  .map(sql=>/^CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql)?.[1])
  .filter(name=>name&&!['async_schema_migrations','async_tenant_identity'].includes(name))
  .sort()
);
const canonicalSet=new Set(canonicalNames);
const identifier=value=>{
 if(typeof value!=='string'||!/^[a-z][a-z0-9_]*$/i.test(value))
   throw Error('Identificador de tabela ou coluna inválido');
 return '"'+value+'"';
};
const stableRow=(row,columns)=>JSON.stringify(columns.map(column=>{
 const value=row[column];
 return typeof value==='bigint'?value.toString():value??null;
}));
const hash=()=>createHash('sha256');
function ensureIntegrity(db){
 const quick=db.prepare('PRAGMA quick_check').all();
 if(quick.length!==1||Object.values(quick[0])[0]!=='ok')
   throw Error('SQLite original não passou PRAGMA quick_check; migração bloqueada');
 const violations=db.prepare('PRAGMA foreign_key_check').all();
 if(violations.length)
   throw Error('SQLite original contém referências estrangeiras órfãs; migração bloqueada');
}
function selectedTables(db){
 const names=new Set(db.prepare(`SELECT name FROM sqlite_master
   WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(r=>r.name));
 const missing=[...names].filter(name=>!canonicalSet.has(name));
 if(missing.length)
   throw Error('Tabelas não suportadas pelo esquema comum: '+missing.join(', '));
 return canonicalNames.filter(name=>names.has(name));
}
function sourceColumns(db,table){
 const rows=db.prepare('PRAGMA table_info('+identifier(table)+')').all();
 if(!rows.length)throw Error('Tabela canônica ausente: '+table);
 const columns=rows.map(row=>row.name);
 const keys=rows.filter(row=>Number(row.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk))
  .map(row=>row.name);
 if(!keys.length)
   throw Error('Tabela '+table+' sem chave primária estável; migração requer revisão');
 return {columns,keys};
}
function scanSqlite(db,name,columns,keys,pageSize=250){
 const state=hash(),order=keys.map(identifier).join(', ');
 const cols=columns.map(identifier).join(', ');
 let count=0;
 while(true){
   const rows=db.prepare(`SELECT ${cols} FROM ${identifier(name)} ORDER BY ${order}
     LIMIT ? OFFSET ?`).all(pageSize,count);
   for(const row of rows){state.update(stableRow(row,columns));state.update('\n');count++;}
   if(rows.length<pageSize)break;
 }
 return {count,sha256:state.digest('hex'),columns,keys};
}
function validateManifest(manifest){
 if(!manifest||typeof manifest!=='object'||!manifest.tables)
   throw Error('Manifesto de migração inválido');
 for(const [name,entry] of Object.entries(manifest.tables)){
   if(!canonicalSet.has(name))throw Error('Tabela fora do esquema canônico: '+name);
   if(!Array.isArray(entry.columns)||!entry.columns.length||
      !Array.isArray(entry.keys)||!entry.keys.length)
     throw Error('Manifesto sem colunas ou chaves: '+name);
   entry.columns.forEach(identifier);
   entry.keys.forEach(identifier);
   if(entry.keys.some(key=>!entry.columns.includes(key)))
     throw Error('Chave não faz parte da tabela: '+name);
 }
}
export function buildCanonicalSqliteManifest(db){
 if(!db||typeof db.prepare!=='function')throw Error('SQLite original necessário');
 ensureIntegrity(db);
 const tables={};let rowsTotal=0;
 for(const name of selectedTables(db)){
   const {columns,keys}=sourceColumns(db,name);
   tables[name]=scanSqlite(db,name,columns,keys);
   rowsTotal+=tables[name].count;
 }
 const attachments=db.prepare(`SELECT COUNT(*) n FROM attachments
   WHERE relative_path NOT LIKE 's3:%'`).get();
 const unresolvedDiskAttachments=Number(attachments?.n||0);
 const digest=hash();
 for(const name of Object.keys(tables).sort()){
   digest.update(name+'\0'+tables[name].count+'\0'+tables[name].sha256+'\n');
 }
 return {
   format:'artisys-workshop-canonical-v1',
   engine:'sqlite',tables,rowsTotal,
   unresolvedDiskAttachments,
   readyForRemote:unresolvedDiskAttachments===0,
   digest:digest.digest('hex'),
   requiresOfflineCutover:true
 };
}
export async function verifyCanonicalTargetManifest(port,manifest){
 if(!['sqlite','postgres','d1'].includes(port?.engine))
   throw Error('Adaptador de banco destino inválido');
 validateManifest(manifest);
 const differences=[];
 for(const [name,entry] of Object.entries(manifest.tables)){
   const columns=entry.columns,keys=entry.keys;
   const state=hash(),order=keys.map(identifier).join(', ');
   const cols=columns.map(identifier).join(', ');
   let count=0;
   try{
     while(true){
       const rows=await port.all(`SELECT ${cols} FROM ${identifier(name)}
         ORDER BY ${order} LIMIT ? OFFSET ?`,[250,count]);
       for(const row of rows){
         state.update(stableRow(row,columns));state.update('\n');count++;
       }
       if(rows.length<250)break;
     }
     const digest=state.digest('hex');
     if(count!==entry.count||digest!==entry.sha256)
       differences.push({table:name,expectedCount:entry.count,actualCount:count,
         expectedSha256:entry.sha256,actualSha256:digest});
   }catch(error){
     differences.push({table:name,error:'Falha de leitura ou esquema divergente: '+error.message});
   }
 }
 return {ok:differences.length===0,differences,verifiedTables:Object.keys(manifest.tables).length,
   sourceDigest:manifest.digest,targetEngine:port.engine,
   readyForCutover:differences.length===0&&manifest.readyForRemote===true};
}
