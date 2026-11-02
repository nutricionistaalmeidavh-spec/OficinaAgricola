import { dirname, join, resolve } from 'node:path';

// ArtiSys Oficina é um produto novo: nunca descobre nem reusa bancos de outros apps.
// DATABASE_PATH explícito continua disponível para ambientes de teste e administradores.
export function resolveDatabasePath({env=process.env,cwd=process.cwd(),canonical=null}={}){
  const explicit=String(env.DATABASE_PATH||'').trim();
  return resolve(explicit?resolve(cwd,explicit):(canonical||join(cwd,'data','artisys-oficina.sqlite')));
}

export function resolveStoragePath({env=process.env,cwd=process.cwd(),databasePath=null}={}){
  const explicit=String(env.STORAGE_DIR||'').trim();
  if(explicit)return resolve(cwd,explicit);
  const root=databasePath?dirname(dirname(resolve(databasePath))):resolve(cwd);
  return join(root,'storage','uploads');
}
