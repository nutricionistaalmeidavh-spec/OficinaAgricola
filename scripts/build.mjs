import {
  cpSync, mkdirSync, rmSync, copyFileSync, readFileSync,
  readdirSync, statSync, existsSync, unlinkSync
} from 'node:fs';
import {resolve,dirname,extname,sep,join} from 'node:path';

// O artefato de produção distribui somente a árvore de dependências do
// gateway PostgreSQL e do bootstrap Electron (PostgreSQL portátil).
// Fontes SQLite históricas podem continuar no repositório para os testes,
// mas não entram no instalador nem constituem um fallback operacional.
const roots=[
  resolve('src/start-postgres-unified.js'),
  resolve('src/platform/postgres-local-instance.js')
];
const srcRoot=resolve('src')+sep;
const included=new Set();
const deps=/\b(?:from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
function collect(file){
  const abs=resolve(file);
  if(!abs.startsWith(srcRoot)||!existsSync(abs)||!statSync(abs).isFile())
    throw Error('Dependência local PostgreSQL ausente ou fora de src: '+file);
  if(included.has(abs))return;
  included.add(abs);
  if(extname(abs)!=='.js'&&extname(abs)!=='.mjs')return;
  const code=readFileSync(abs,'utf8');
  for(const match of code.matchAll(deps)){
    const name=match[2];
    const path=resolve(dirname(abs),name);
    collect(path);
  }
}
for(const root of roots)collect(root);

rmSync('dist',{recursive:true,force:true});
mkdirSync('dist',{recursive:true});
cpSync('src','dist/src',{recursive:true});
// dist/src pode conter documentação e workers não-JS;
// remove todos os módulos JS que não pertencem ao grafo PostgreSQL.
const distRoot=resolve('dist/src');
const prune=dir=>{
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())prune(path);
  else if(/\.(?:m?js)$/.test(path)){
    const relative=path.slice(distRoot.length+1);
    if(!included.has(resolve('src',relative)))unlinkSync(path);
  }
 }
};
prune(distRoot);
cpSync('public','dist/public',{recursive:true});
copyFileSync('package.json','dist/package.json');
console.log('Build PostgreSQL-only criado em dist/: '+included.size+' módulos do core.');
