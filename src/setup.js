import {transaction} from './db.js';
import {createUser} from './auth.js';

const localAddress = value => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(value||''));
const localHost = value => /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(String(value||''));
export function isLocalSetupRequest(req){
  if(!localAddress(req?.socket?.remoteAddress))return false;
  const host=String(req?.headers?.host||'');
  if(!localHost(host))return false;
  const origin=req?.headers?.origin;
  if(!origin)return true;
  try{
    const url=new URL(origin);
    return url.protocol==='http:'&&url.host===host;
  }catch{return false}
}
export function isSetupRequired(db){
  return Number(db.prepare('SELECT COUNT(*) n FROM users').get().n)===0;
}
export function initializeAdmin(db,req,input){
  if(!isLocalSetupRequest(req))throw new Error('Configuração inicial permitida somente na máquina principal (localhost)');
  const username=String(input?.username||'').trim();
  const name=String(input?.name||'').trim();
  const password=input?.password;
  if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))throw new Error('Usuário deve ter 3–40 caracteres válidos');
  if(name.length<3||name.length>100)throw new Error('Nome do administrador inválido');
  if(typeof password!=='string'||password.length<12||password.length>128||
    !/[a-z]/.test(password)||!/[A-Z]/.test(password)||!/[0-9]/.test(password)||
    !/[^a-zA-Z0-9]/.test(password)||password==='Admin@1234')
    throw new Error('Senha deve ter 12–128 caracteres, maiúscula, minúscula, número e símbolo');
  if(password!==input.confirmPassword)throw new Error('As senhas não coincidem');
  return transaction(db,()=>{
    if(!isSetupRequired(db))throw new Error('Configuração inicial já concluída');
    const id=createUser(db,{username,name,password,role:'ADMIN'});
    return {id,username,name,role:'ADMIN'};
  });
}
