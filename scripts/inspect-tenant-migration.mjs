#!/usr/bin/env node
import {DatabaseSync} from 'node:sqlite';
import {statSync,realpathSync} from 'node:fs';
import {buildCanonicalSqliteManifest} from '../src/platform/tenant-migration-manifest.js';

// Operator-only dry run. Never opens a writable SQLite connection, connects
// to a cloud database, writes a backup, or changes which DB is authoritative.
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--file'||!args[1]){
 console.error('Uso: node scripts/inspect-tenant-migration.mjs --file /caminho/para/oficina.sqlite');
 process.exit(2);
}
let db;
try{
 const source=realpathSync(args[1]);
 if(!statSync(source).isFile())throw Error('Origem não é um arquivo SQLite regular');
 db=new DatabaseSync(source,{readOnly:true});
 const manifest=buildCanonicalSqliteManifest(db);
 process.stdout.write(JSON.stringify(manifest,null,2)+'\n');
 if(!manifest.readyForRemote){
   console.error('Atenção: '+manifest.unresolvedDiskAttachments+
     ' anexo(s) locais requerem transferência separada antes do cutover.');
 }
}catch(error){
 console.error('Auditoria de migração recusada: '+error.message);
 process.exitCode=1;
}finally{if(db)db.close();}
