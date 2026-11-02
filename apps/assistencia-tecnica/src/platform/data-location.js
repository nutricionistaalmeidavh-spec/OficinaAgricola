import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Sem exclusão, sobrescrita ou migração silenciosa dos dados legados.
export function resolveDatabasePath({
  env=process.env,
  cwd=process.cwd(),
  candidates=null,
  canonical=null,
  exists=existsSync,
}={}){
  const explicit=String(env.DATABASE_PATH||'').trim();
  if(explicit)return resolve(cwd,explicit);
  const defaultPath=resolve(canonical||join(cwd,'data','artisys-oficina.sqlite'));
  const legacy=candidates||[
    join(cwd,'data','assistencia-tecnica.sqlite'),
    join(cwd,'data','oficina.sqlite'),
    join(cwd,'apps','assistencia-tecnica','data','assistencia-tecnica.sqlite'),
  ];
  const found=[...new Set([defaultPath,...legacy.map(p=>resolve(p))])].filter(exists);
  if(found.length>1){
    throw new Error('Foram encontrados bancos legados diferentes. Informe DATABASE_PATH explicitamente para selecionar o banco correto; nenhum deles foi apagado ou mesclado. Fontes: '+found.join(', '));
  }
  return found[0]||defaultPath;
}
