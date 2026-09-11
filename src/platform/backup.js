import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
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
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(path);
    }
  };
  walk(root);
  return files.sort();
}

function manifestEntry(root, filePath) {
  const stat = statSync(filePath);
  return {
    path: relative(root, filePath).split(sep).join('/'),
    size: stat.size,
    sha256: hashFile(filePath)
  };
}

function safePath(root, relPath) {
  const base = resolve(root);
  const target = resolve(root, relPath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('Manifesto de backup inválido');
  return target;
}

export function verifyBackup(backupDir) {
  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('Manifesto de backup ausente');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Manifesto de backup inválido');
  for (const entry of manifest.files) {
    const filePath = safePath(backupDir, entry.path);
    if (!existsSync(filePath) || hashFile(filePath) !== entry.sha256 || statSync(filePath).size !== entry.size) {
      throw new Error(`Falha de integridade no backup: ${entry.path}`);
    }
  }
  return manifest;
}

export function createBackup({ databasePath, uploadsPath, backupRoot, now = new Date() }) {
  if (!existsSync(databasePath)) throw new Error('Banco não encontrado para backup');
  mkdirSync(backupRoot, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupDir = join(backupRoot, `${stamp}-${randomUUID().slice(0, 8)}`);
  const tempDir = `${backupDir}.tmp`;
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(join(tempDir, 'uploads'), { recursive: true });
  try {
    copyFileSync(databasePath, join(tempDir, 'database.sqlite'));
    if (uploadsPath && existsSync(uploadsPath)) cpSync(uploadsPath, join(tempDir, 'uploads'), { recursive: true });
    const files = listFiles(tempDir).map(file => manifestEntry(tempDir, file));
    const manifest = { version: 1, createdAt: now.toISOString(), files };
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
