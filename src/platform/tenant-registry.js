import { nowIso, transaction } from '../db.js';
import { createUser } from '../auth.js';

const ROLES = new Set(['ADMIN', 'ATENDIMENTO', 'TECNICO', 'FINANCEIRO']);
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const CODE = /^[A-Za-z0-9_-]{2,32}$/;
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };

export function migrateTenantRegistry(db, legacyDb = null) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,expires_at TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS tenant_companies (id INTEGER PRIMARY KEY AUTOINCREMENT,slug TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS tenant_units (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES tenant_companies(id),code TEXT NOT NULL COLLATE NOCASE,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(company_id,code));" +
    "CREATE TABLE IF NOT EXISTS tenant_memberships (user_id INTEGER NOT NULL REFERENCES users(id),unit_id INTEGER NOT NULL REFERENCES tenant_units(id),role TEXT NOT NULL CHECK(role IN ('ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO')),active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,unit_id));" +
    "CREATE TABLE IF NOT EXISTS tenant_platform_admins (user_id INTEGER PRIMARY KEY REFERENCES users(id));" +
    "CREATE INDEX IF NOT EXISTS idx_tenant_memberships_unit ON tenant_memberships(unit_id,active,user_id);" +
    "CREATE INDEX IF NOT EXISTS idx_tenant_units_company ON tenant_units(company_id,active);"
  );
  // Never silently recreate a lost registry: old tenant-specific accounts
  // would otherwise be granted access to the default operational database.
  const marker=legacyDb?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenant_registry_link'").get();
  const globalUsers=db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if(marker && !globalUsers)
    fail('Registro de empresas ausente: restaure o backup do registro antes de iniciar',409);
  // Legacy bootstrap is transactional. Never overwrite an existing registry.
  const result=transaction(db, () => {
    db.prepare("INSERT OR IGNORE INTO tenant_companies(id,slug,name,created_at) VALUES(1,'principal','Oficina principal',?)").run(nowIso());
    db.prepare("INSERT OR IGNORE INTO tenant_units(id,company_id,code,name,created_at) VALUES(1,1,'MATRIZ','Matriz',?)").run(nowIso());
    if (!legacyDb || db.prepare('SELECT COUNT(*) n FROM users').get().n !== 0) return;
    for (const user of legacyDb.prepare('SELECT * FROM users ORDER BY id').all()) {
      db.prepare('INSERT INTO users(id,username,password_hash,name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(user.id,user.username,user.password_hash,user.name,user.role,user.active,user.created_at,user.updated_at);
      db.prepare('INSERT INTO tenant_memberships(user_id,unit_id,role,active) VALUES(?,?,?,?)')
        .run(user.id,1,user.role,user.active);
    }
    for (const session of legacyDb.prepare('SELECT * FROM sessions WHERE expires_at>?').all(nowIso())) {
      db.prepare('INSERT OR IGNORE INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
        .run(session.token_hash,session.user_id,session.created_at,session.expires_at);
    }
    const admin=db.prepare("SELECT id FROM users WHERE role='ADMIN' AND active=1 ORDER BY id LIMIT 1").get();
    if (admin) db.prepare('INSERT OR IGNORE INTO tenant_platform_admins(user_id) VALUES(?)').run(admin.id);
  });
  if(legacyDb && db.prepare('SELECT COUNT(*) n FROM users').get().n)
    markLegacyRegistryLink(legacyDb);
  return result;
}
export function markLegacyRegistryLink(legacyDb) {
  legacyDb.exec("CREATE TABLE IF NOT EXISTS tenant_registry_link (id INTEGER PRIMARY KEY CHECK(id=1),linked_at TEXT NOT NULL)");
  legacyDb.prepare('INSERT OR IGNORE INTO tenant_registry_link(id,linked_at) VALUES(1,?)').run(nowIso());
}

export function registerInitialAdmin(db, userId) {
  return transaction(db, () => {
    const user=db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(userId);
    if (!user) fail('Usuário inválido', 400);
    if (db.prepare('SELECT COUNT(*) n FROM tenant_platform_admins').get().n) fail('Administrador inicial já definido', 409);
    db.prepare('INSERT INTO tenant_platform_admins(user_id) VALUES(?)').run(userId);
    db.prepare("INSERT INTO tenant_memberships(user_id,unit_id,role,active) VALUES(? ,1,'ADMIN',1) ON CONFLICT(user_id,unit_id) DO UPDATE SET role='ADMIN',active=1").run(userId);
  });
}
export const isPlatformAdmin = (db,userId) =>
  Boolean(db.prepare('SELECT 1 FROM tenant_platform_admins WHERE user_id=?').get(userId));

export function listUserUnits(db, userId) {
  return db.prepare("SELECT u.id,u.company_id AS companyId,u.code,u.name,u.active AS unitActive,c.slug AS companySlug,c.name AS companyName,c.active AS companyActive,m.role FROM tenant_memberships m JOIN tenant_units u ON u.id=m.unit_id JOIN tenant_companies c ON c.id=u.company_id WHERE m.user_id=? AND m.active=1 AND u.active=1 AND c.active=1 ORDER BY c.id,u.id")
    .all(userId);
}
export function requireUnitMembership(db,userId,unitId) {
  const id=Number(unitId);
  if (!Number.isSafeInteger(id) || id<1) fail('Unidade inválida', 400);
  const unit=db.prepare("SELECT u.id,u.company_id AS companyId,u.code,u.name,m.role FROM tenant_memberships m JOIN tenant_units u ON u.id=m.unit_id JOIN tenant_companies c ON c.id=u.company_id WHERE m.user_id=? AND u.id=? AND m.active=1 AND u.active=1 AND c.active=1")
    .get(userId,id);
  if (!unit) fail('Permissão: acesso à unidade negado');
  return unit;
}
export function requireCompanyAdmin(db,userId,companyId) {
  const result=db.prepare("SELECT 1 FROM tenant_memberships m JOIN tenant_units u ON u.id=m.unit_id JOIN tenant_companies c ON c.id=u.company_id WHERE m.user_id=? AND u.company_id=? AND m.active=1 AND m.role='ADMIN' AND u.active=1 AND c.active=1 LIMIT 1").get(userId,companyId);
  if (!result) fail('Permissão: administração da empresa necessária');
}
export function createTenantCompany(db,userId,{slug,name}={}) {
  if (!isPlatformAdmin(db,userId)) fail('Permissão: administração da plataforma necessária');
  const cleanSlug=String(slug||'').trim().toLowerCase(),cleanName=String(name||'').trim();
  if (!SLUG.test(cleanSlug)||cleanName.length<2||cleanName.length>120) fail('Dados da empresa inválidos',400);
  return transaction(db,()=>{
    const companyId=Number(db.prepare('INSERT INTO tenant_companies(slug,name,created_at) VALUES(?,?,?)').run(cleanSlug,cleanName,nowIso()).lastInsertRowid);
    const unitId=Number(db.prepare("INSERT INTO tenant_units(company_id,code,name,created_at) VALUES(?,'MATRIZ','Matriz',?)").run(companyId,nowIso()).lastInsertRowid);
    db.prepare("INSERT INTO tenant_memberships(user_id,unit_id,role) VALUES(?,?,'ADMIN')").run(userId,unitId);
    return {id:companyId,slug:cleanSlug,name:cleanName,unitId};
  });
}
export function createTenantUnit(db,userId,{companyId,code,name}={}) {
  const cid=Number(companyId); requireCompanyAdmin(db,userId,cid);
  const unitCode=String(code||'').trim().toUpperCase(),unitName=String(name||'').trim();
  if(!CODE.test(unitCode)||unitName.length<2||unitName.length>120) fail('Dados da unidade inválidos',400);
  return transaction(db,()=>{
    const id=Number(db.prepare('INSERT INTO tenant_units(company_id,code,name,created_at) VALUES(?,?,?,?)').run(cid,unitCode,unitName,nowIso()).lastInsertRowid);
    db.prepare("INSERT INTO tenant_memberships(user_id,unit_id,role) VALUES(?,?,'ADMIN')").run(userId,id);
    return {id,companyId:cid,code:unitCode,name:unitName};
  });
}
export function listUnitMembers(db,userId,unitId) {
  const unit=requireUnitMembership(db,userId,unitId);
  if(unit.role!=='ADMIN') fail('Permissão: administração da unidade necessária');
  return db.prepare("SELECT x.id,x.username,x.name,x.active,m.role,m.active AS membershipActive FROM tenant_memberships m JOIN users x ON x.id=m.user_id WHERE m.unit_id=? ORDER BY x.name").all(unit.id);
}
export function grantUnitMembership(db,adminId,{unitId,username,name,password,role}={}) {
  const unit=requireUnitMembership(db,adminId,unitId);
  if(unit.role!=='ADMIN')fail('Permissão: administração da unidade necessária');
  if(!ROLES.has(role))fail('Perfil inválido',400);
  const handle=String(username||'').trim();
  if(!/^[A-Za-z0-9_.-]{3,40}$/.test(handle))fail('Usuário inválido',400);
  return transaction(db,()=>{
    let user=db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(handle);
    if(!user){
      const fullName=String(name||'').trim();
      if(fullName.length<2||fullName.length>100||typeof password!=='string'||password.length<12)fail('Nome e senha forte são obrigatórios para novo usuário',400);
      const id=createUser(db,{username:handle,password,name:fullName,role:'ATENDIMENTO'});
      user={id};
    }
    db.prepare('INSERT INTO tenant_memberships(user_id,unit_id,role,active) VALUES(?,?,?,1) ON CONFLICT(user_id,unit_id) DO UPDATE SET role=excluded.role,active=1')
      .run(user.id,unit.id,role);
    return {id:user.id,unitId:unit.id,role};
  });
}
export function changeUnitMembership(db,adminId,{unitId,userId,role,active}={}) {
  const unit=requireUnitMembership(db,adminId,unitId);
  if(unit.role!=='ADMIN')fail('Permissão: administração da unidade necessária');
  if(!ROLES.has(role))fail('Perfil inválido',400);
  const id=Number(userId);
  return transaction(db,()=>{
    const current=db.prepare('SELECT * FROM tenant_memberships WHERE user_id=? AND unit_id=?').get(id,unit.id);
    if(!current)fail('Vínculo não encontrado',404);
    if(current.role==='ADMIN' && (role!=='ADMIN'||active===false)){
      const others=db.prepare("SELECT COUNT(*) n FROM tenant_memberships WHERE unit_id=? AND role='ADMIN' AND active=1").get(unit.id).n;
      if(others<2)fail('Último administrador da unidade não pode ser removido',409);
    }
    db.prepare('UPDATE tenant_memberships SET role=?,active=? WHERE user_id=? AND unit_id=?')
      .run(role,active===false?0:1,id,unit.id);
    return {id,unitId:unit.id,role,active:active!==false};
  });
}
