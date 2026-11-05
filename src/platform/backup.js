import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = current => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Backup contém link simbólico');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(path);
      else throw new Error('Backup contém tipo de arquivo não suportado');
    }
  };
  walk(root);
  return files.sort();
}

function manifestEntry(root, filePath) {
  const stat = statSync(filePath);
  return { path: relative(root, filePath).split(sep).join('/'), size: stat.size, sha256: hashFile(filePath) };
}

function safePath(root, relPath) {
  if (typeof relPath !== 'string' || relPath.includes('\\') ||
      relPath.includes('\0')) throw new Error('Manifesto de backup inválido');
  const segments=relPath.split('/');
  if (segments.some(x=>!x || x==='.' || x==='..') ||
      !(relPath==='database.sqlite' || (segments[0]==='uploads' && segments.length>1)))
    throw new Error('Manifesto de backup inválido');
  const base=resolve(root), target=resolve(base,relPath);
  if (!target.startsWith(base+sep)) throw new Error('Manifesto de backup inválido');
  let current=base;
  for (const segment of segments) {
    current=join(current,segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('Backup contém link simbólico');
  }
  return target;
}

export function verifyBackup(backupDir) {
  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) throw new Error('Manifesto de backup ausente ou inválido');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Manifesto de backup inválido');
  const listed=new Set();
  for (const entry of manifest.files) {
    if (!entry || !Number.isSafeInteger(entry.size) || entry.size<0 ||
        typeof entry.sha256!=='string' || !/^[a-f0-9]{64}$/i.test(entry.sha256) ||
        listed.has(entry.path)) throw new Error('Manifesto de backup inválido');
    const filePath=safePath(backupDir,entry.path);
    listed.add(entry.path);
    if (!existsSync(filePath) || !lstatSync(filePath).isFile() ||
        statSync(filePath).size!==entry.size || hashFile(filePath)!==entry.sha256)
      throw new Error(`Falha de integridade no backup: ${entry.path}`);
  }
  if (!listed.has('database.sqlite')) throw new Error('Backup sem banco de dados');
  const onDisk=listFiles(backupDir).map(p=>relative(backupDir,p).split(sep).join('/')).filter(p=>p!=='manifest.json');
  if (onDisk.length!==listed.size || onDisk.some(p=>!listed.has(p)))
    throw new Error('Backup contém arquivos não verificados');
  return manifest;
}

export function createBackup({ databasePath, uploadsPath, backupRoot, now = new Date(), tenant = null }) {
  if (!existsSync(databasePath)) throw new Error('Banco não encontrado para backup');
  mkdirSync(backupRoot, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupDir = join(backupRoot, `${stamp}-${randomUUID().slice(0, 8)}`);
  const tempDir = `${backupDir}.tmp`;
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(join(tempDir, 'uploads'), { recursive: true });
  try {
    // VACUUM INTO cria snapshot transacional consistente mesmo com WAL ativo.
    // Cópia simples do .sqlite deixaria de fora transações ainda presentes no -wal.
    const source=new DatabaseSync(databasePath,{readOnly:true});
    try {
      const snapshotPath=join(tempDir,'database.sqlite').replaceAll("'","''");
      source.exec(`VACUUM INTO '${snapshotPath}'`);
    } finally {source.close();}
    if (uploadsPath && existsSync(uploadsPath)) cpSync(uploadsPath, join(tempDir, 'uploads'), { recursive: true });
    const files = listFiles(tempDir).map(file => manifestEntry(tempDir, file));
    // Tenant ownership is metadata from the trusted registry, never a client
    // field. Old generic backup calls remain unchanged when tenant is null.
    let owner=null;
    if(tenant!==null){
      const companyId=Number(tenant.companyId),unitId=Number(tenant.unitId);
      if(!Number.isSafeInteger(companyId)||companyId<1||
         !Number.isSafeInteger(unitId)||unitId<1)
        throw Error('Identidade de backup multiempresa inválida');
      owner={companyId,unitId};
    }
    const manifest = { version: 1, createdAt: now.toISOString(), files,
      ...(owner?{tenant:owner}:{}) };
    writeFileSync(join(tempDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    renameSync(tempDir, backupDir);
    return { backupDir, manifest };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export function restoreBackup({ backupDir, databasePath, uploadsPath }) {
  verifyBackup(backupDir);
  // Integridade SQLite ANTES de mover qualquer arquivo da instalação existente.
  const source=new DatabaseSync(join(backupDir,'database.sqlite'),{readOnly:true});
  try {
    const integrity=source.prepare('PRAGMA integrity_check').all();
    if (integrity.length!==1 || integrity[0].integrity_check!=='ok' ||
        source.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Banco do backup não passou na verificação SQLite');
  } finally {source.close();}
  const token = randomUUID().slice(0, 8);
  const dbStage = `${databasePath}.restore-${token}`;
  const dbPrevious = `${databasePath}.previous-${token}`;
  const uploadsStage = `${uploadsPath}.restore-${token}`;
  const uploadsPrevious = `${uploadsPath}.previous-${token}`;

  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(dirname(uploadsPath), { recursive: true });
  copyFileSync(join(backupDir, 'database.sqlite'), dbStage);
  rmSync(uploadsStage, { recursive: true, force: true });
  cpSync(join(backupDir, 'uploads'), uploadsStage, { recursive: true });

  const hadDb = existsSync(databasePath);
  const hadUploads = existsSync(uploadsPath);
  try {
    if (hadDb) renameSync(databasePath, dbPrevious);
    if (hadUploads) renameSync(uploadsPath, uploadsPrevious);
    renameSync(dbStage, databasePath);
    renameSync(uploadsStage, uploadsPath);
    rmSync(dbPrevious, { force: true });
    rmSync(uploadsPrevious, { recursive: true, force: true });
  } catch (error) {
    rmSync(databasePath, { force: true });
    rmSync(uploadsPath, { recursive: true, force: true });
    if (hadDb && existsSync(dbPrevious)) renameSync(dbPrevious, databasePath);
    if (hadUploads && existsSync(uploadsPrevious)) renameSync(uploadsPrevious, uploadsPath);
    rmSync(dbStage, { force: true });
    rmSync(uploadsStage, { recursive: true, force: true });
    throw error;
  }
}
