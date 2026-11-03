import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';

// Read-only diagnostic. Never migrates or modifies customer data.
const filename=process.argv[2];
if(!filename||!existsSync(filename)){
 console.error('Uso: node scripts/db-health.mjs <caminho-para-banco.sqlite>');
 process.exitCode=2;
}else{
 const db=new DatabaseSync(resolve(filename),{readOnly:true});
 try{
  const rows=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables=rows.map(({name})=>{
   const safe='"'+name.replaceAll('"','""')+'"';
   return {table:name,records:db.prepare('SELECT COUNT(*) n FROM '+safe).get().n,
    indexes:db.prepare('PRAGMA index_list('+safe+')').all().map(x=>x.name)};
  });
  const integrity=db.prepare('PRAGMA quick_check').get().quick_check;
  const foreignKeys=db.prepare('PRAGMA foreign_key_check').all().length;
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT id FROM work_orders WHERE status='ENTRADA' ORDER BY id DESC LIMIT 50").all().map(x=>x.detail);
  const pageCount=db.prepare('PRAGMA page_count').get().page_count;
  const pageSize=db.prepare('PRAGMA page_size').get().page_size;
  console.log(JSON.stringify({integrity,foreignKeyViolations:foreignKeys,
    bytes:pageCount*pageSize,walMode:db.prepare('PRAGMA journal_mode').get().journal_mode,
    plan,tables},null,2));
  if(integrity!=='ok'||foreignKeys)process.exitCode=1;
 }finally{db.close();}
}
