// Read-only P0 inventory of PostgreSQL cutover blockers.
// No credentials, network access, mutations or production DB connections.
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {relative,resolve,join} from 'node:path';
import {nativeRouteCoverage} from '../src/platform/native-api-route-map.js';

const root=resolve(import.meta.dirname,'..');
const roots=['src','electron','public'];
const blockers=[];
const perFile=[];
const pattern=/\b(?:DatabaseSync|openDatabase|migrateAssistencia|migrateTenantRegistry)\s*\(|\bPRAGMA\s+|\.prepare\s*\(/g;
function walk(base){
 for(const entry of readdirSync(base,{withFileTypes:true})){
   if(entry.name==='node_modules'||entry.name==='.git'||entry.name==='dist')continue;
   const full=join(base,entry.name);
   if(entry.isDirectory())walk(full);
   else if(entry.isFile()&&/\.(?:js|mjs|cjs)$/.test(entry.name)){
     const path=relative(root,full).replaceAll('\\','/');
     const source=readFileSync(full,'utf8');
     const hits=[];
     source.split('\n').forEach((line,index)=>{
       pattern.lastIndex=0;
       if(pattern.test(line))hits.push(index+1);
     });
     if(hits.length){
       const type=path.startsWith('src/platform/tenant-migration-')||
         path.startsWith('src/platform/recovery-')||
         path.startsWith('src/platform/tenant-recovery-')||
         /^src\/(?:db|migrate|seed)/.test(path)?'migration-or-legacy':'runtime-candidate';
       const item={path,type,lines:hits};
       blockers.push(item);
       perFile.push(path);
     }
   }
 }
}
for(const dir of roots){
 const path=join(root,dir);
 try{if(statSync(path).isDirectory())walk(path);}catch(error){
   if(error.code!=='ENOENT')throw error;
 }
}
const legacyCandidates=blockers.filter(x=>x.type==='runtime-candidate');
const summary={
 sourceBranch:'PR-32',
 contract:'PostgreSQL-primary, async, one registry and explicit tenant isolation',
 routeMappings:nativeRouteCoverage.length,
 filesWithSyncDatabasePatterns:perFile.length,
 runtimeBlockerFiles:legacyCandidates.length,
 runtimeBlockers:legacyCandidates,
 migrationAndLegacyFiles:blockers.filter(x=>x.type==='migration-or-legacy'),
 warning:'RegEx inventory is a starting point; inspect dynamic SQL, business jobs, fiscal bridge and browser routes manually.'
};
if(process.argv.includes('--summary')){
 console.log(JSON.stringify({routeMappings:summary.routeMappings,
  filesWithSyncDatabasePatterns:summary.filesWithSyncDatabasePatterns,
  runtimeBlockerFiles:summary.runtimeBlockerFiles,paths:legacyCandidates.map(x=>x.path)},null,2));
}else console.log(JSON.stringify(summary,null,2));
if(process.argv.includes('--strict')&&legacyCandidates.length){
 console.error('Cutover PostgreSQL impedido: dependências SQLite no runtime');
 process.exitCode=2;
}
