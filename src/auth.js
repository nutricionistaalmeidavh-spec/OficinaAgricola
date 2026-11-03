import { randomBytes, scryptSync, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { nowIso } from './db.js';

const ROLES = new Set(['ADMIN', 'ATENDIMENTO', 'TECNICO', 'FINANCEIRO']);
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const scryptAsync=promisify(scrypt);

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('Senha deve ter pelo menos 8 caracteres');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [kind, saltHex, hashHex] = String(encoded).split('$');
    if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

export async function verifyPasswordAsync(password,encoded){
  try{
    const [kind,saltHex,hashHex]=String(encoded).split('$');
    if(kind!=='scrypt'||!saltHex||!hashHex)return false;
    const expected=Buffer.from(hashHex,'hex');
    const actual=await scryptAsync(password,Buffer.from(saltHex,'hex'),expected.length);
    return expected.length===actual.length&&timingSafeEqual(expected,actual);
  }catch{return false}
}

export async function loginAsync(db,username,password){
  const user=db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1').get(username);
  if(!user||!(await verifyPasswordAsync(password,user.password_hash)))
    throw new Error('Credenciais inválidas');
  const token=randomBytes(32).toString('base64url');
  const createdAt=nowIso(),expiresAt=new Date(Date.now()+12*60*60*1000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .run(tokenHash(token),user.id,createdAt,expiresAt);
  return {token,expiresAt,user:sanitizeUser(user)};
}

export function createUser(db, { username, password, role, name }) {
  if (!username?.trim() || !name?.trim() || !ROLES.has(role)) throw new Error('Usuário inválido');
  const t = nowIso();
  const result = db.prepare('INSERT INTO users(username,password_hash,name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(username.trim(), hashPassword(password), name.trim(), role, t, t);
  return Number(result.lastInsertRowid);
}

export function login(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('Credenciais inválidas');
  const token = randomBytes(32).toString('base64url');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .run(tokenHash(token), user.id, createdAt, expiresAt);
  return { token, expiresAt, user: sanitizeUser(user) };
}

export function validateSession(db, token) {
  if (!token) throw new Error('Sessão inválida');
  const row = db.prepare(`SELECT u.id,u.username,u.name,u.role,u.active,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(tokenHash(token));
  if (!row || !row.active || new Date(row.expires_at).getTime() <= Date.now()) throw new Error('Sessão inválida');
  return sanitizeUser(row);
}

export function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
}

export function requireRole(user, allowed) {
  if (!user || !allowed.includes(user.role)) throw new Error('Permissão insuficiente');
  return true;
}

function sanitizeUser(user) {
  return { id: Number(user.id), username: user.username, name: user.name, role: user.role };
}
