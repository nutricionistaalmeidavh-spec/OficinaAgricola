import {statSync,readFileSync} from 'node:fs';
import {createSecureSmtpReminderSender} from './billing-smtp.js';

// Configuração explícita por unidade em arquivo privado, nunca herda de matriz.
export function loadTenantReminderSenders(file){
 if(!file)return ()=>null;
 const stat=statSync(file);
 if(!stat.isFile()||stat.size>65536)throw Error('Mapa privado SMTP inválido ou acima de 64 KiB');
 if(process.platform!=='win32'&&(stat.mode&0o077)!==0)
  throw Error('Mapa SMTP privado deve ter permissão 0600');
 const config=JSON.parse(readFileSync(file,'utf8'));
 if(!config||typeof config!=='object'||Array.isArray(config))
  throw Error('Mapa SMTP por empresa/unidade inválido');
 const senders=new Map();
 for(const [identity,details] of Object.entries(config)){
  if(!/^[1-9]\d*\/[1-9]\d*$/.test(identity))throw Error('Identidade SMTP de unidade inválida');
  if(!details||typeof details!=='object'||Array.isArray(details)||
   Object.keys(details).some(k=>!['host','port','from','user','password'].includes(k)))
   throw Error('Configuração SMTP por unidade contém campo inválido');
  senders.set(identity,createSecureSmtpReminderSender(details));
 }
 return unit=>senders.get(String(unit.companyId)+'/'+String(unit.id))??null;
}
