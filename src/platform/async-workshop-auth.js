import {randomBytes,createHash,scryptSync,scrypt,timingSafeEqual} from 'node:crypto';

// Shared offline and native SQL authentication.
// Backends are isolated per company/unit; the token hash never leaves its DB.
const VALID_ROLES=new Set(['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO']);
const issueId=()=>randomBytes(6).readUIntBE(0,6);
const tokenHash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clean=value=>String(value??'').trim();
const now=()=>new Date().toISOString();
const affected=value=>Number(value?.changes??value?.meta?.changes??0);
const sanitize=row=>({id:Number(row.id),username:row.username,name:row.name,role:row.role});
const strongPassword=value=>typeof value==='string'&&value.length>=8&&value.length<=256;
function encodePassword(password){
 if(!strongPassword(password))fail('Senha deve ter entre 8 e 256 caracteres');
 const salt=randomBytes(16);
 return 'scrypt$'+salt.toString('hex')+'$'+scryptSync(password,salt,64).toString('hex');
}
async function verifyPassword(password,encoded){
 const [kind,salt,hash]=String(encoded||'').split('$');
 if(kind!=='scrypt'||!salt||!hash)return false;
 try{
   const expected=Buffer.from(hash,'hex');
   if(expected.length!==64||Buffer.from(salt,'hex').length!==16)return false;
   const derived=await new Promise((resolve,reject)=>scrypt(String(password||''),
     Buffer.from(salt,'hex'),expected.length,(err,result)=>err?reject(err):resolve(result)));
   return timingSafeEqual(expected,derived);
 }catch{return false;}
}
function fields(input){
 const username=clean(input.username).toLowerCase(),name=clean(input.name),role=clean(input.role);
 if(!/^[a-z0-9._-]{3,64}$/.test(username)||!name||name.length>160||!VALID_ROLES.has(role))
   fail('Usuário inválido');
 return {username,name,role,passwordHash:encodePassword(input.password)};
}
export function createAsyncWorkshopAuth(port){
 if(!['sqlite','postgres','d1'].includes(port?.engine))fail('Adaptador de autenticação inválido');
 async function insertUser(input,{onlyFirst=false}={}){
   const data=fields(input),userId=issueId(),timestamp=now();
   const sql=`INSERT INTO users(id,username,password_hash,name,role,created_at,updated_at)
     SELECT ?,?,?,?,?,?,?
     ${onlyFirst?'WHERE NOT EXISTS(SELECT 1 FROM users)':''}`;
   const result=await port.run(sql,[
     userId,data.username,data.passwordHash,data.name,data.role,timestamp,timestamp
   ]);
   if(affected(result)!==1)fail('Bootstrap de administrador já desabilitado: existem usuários',409);
   return sanitize(await port.first('SELECT * FROM users WHERE id=?',[userId]));
 }
 async function bootstrapAdmin(input={}){
   if(input.role&&input.role!=='ADMIN')fail('Bootstrap exclusivo para ADMIN');
   return insertUser({...input,role:'ADMIN'},{onlyFirst:true});
 }
 async function createUser(input={},adminToken){
   const actor=await validateSession(adminToken);
   if(actor.role!=='ADMIN')fail('Permissão insuficiente',403);
   return insertUser(input);
 }
 async function login({username,password}={}){
   const normalized=clean(username).toLowerCase();
   const user=await port.first(`SELECT * FROM users
     WHERE username=? AND active=1`,[normalized]);
   // Keep a fixed-cost path even if the username is absent.
   const fallback='scrypt$59a16c0f49265c11604b4b2782f6c32d$'+
     '110df40dbe83db0b7ab6f73ed3b825a726cc26f9147d09a83dbbecf725bf3c02'+
     '737747c94e4810a58613104ecfe4e882865311b4e4513d7598ab1ab4434043a86';
   const valid=await verifyPassword(password,user?.password_hash||fallback);
   if(!user||!valid)fail('Credenciais inválidas',401);
   const token=randomBytes(32).toString('base64url'),timestamp=now(),
     expiresAt=new Date(Date.now()+12*60*60*1000).toISOString();
   await port.run(`INSERT INTO sessions(id,token_hash,user_id,created_at,expires_at)
     VALUES(?,?,?,?,?)`,[
     issueId(),tokenHash(token),Number(user.id),timestamp,expiresAt
   ]);
   return {token,expiresAt,user:sanitize(user)};
 }
 async function validateSession(token){
   if(typeof token!=='string'||token.length<32)fail('Sessão inválida',401);
   const row=await port.first(`SELECT u.id,u.username,u.name,u.role,u.active,s.expires_at
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`,
     [tokenHash(token)]);
   if(!row||!row.active||new Date(row.expires_at).getTime()<=Date.now())
     fail('Sessão inválida',401);
   return sanitize(row);
 }
 async function requireRole(token,roles=[]){
   const user=await validateSession(token);
   if(!Array.isArray(roles)||!roles.includes(user.role))fail('Permissão insuficiente',403);
   return user;
 }
 async function logout(token){
   if(typeof token==='string'&&token.length>=32)
     await port.run('DELETE FROM sessions WHERE token_hash=?',[tokenHash(token)]);
   return {ok:true};
 }
 return Object.freeze({bootstrapAdmin,createUser,login,validateSession,requireRole,logout});
}
