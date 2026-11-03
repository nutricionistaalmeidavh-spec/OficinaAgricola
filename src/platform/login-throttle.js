// Limitador de autenticação em memória: local por instância do servidor.
// Nunca usa banco de dados nem serviço pago. Persistência não necessária:
// depois de reiniciar, o limite reinicia; não substitui firewall/TLS.
export function createLoginLimiter({limit=6,windowMs=60000,now=()=>Date.now()}={}){
 const attempts=new Map();
 const keyFor=(username,ip)=>String(ip||'unknown')+'|'+String(username||'').toLowerCase().trim().slice(0,100);
 function check(username,ip){
  const key=keyFor(username,ip),t=now();
  const entry=attempts.get(key);
  if(entry&&t-entry.startedAt<windowMs&&entry.count>=limit){
   const e=new Error('Excesso de tentativas de login. Tente novamente em alguns instantes.');
   e.statusCode=429;
   throw e;
  }
  if(attempts.size>2000)for(const [k,value] of attempts){
    if(t-value.startedAt>=windowMs)attempts.delete(k);
  }
  return key;
 }
 function fail(username,ip){
  const key=keyFor(username,ip),t=now();
  const current=attempts.get(key);
  if(!current||t-current.startedAt>=windowMs)attempts.set(key,{startedAt:t,count:1});
  else current.count++;
 }
 function success(username,ip){attempts.delete(keyFor(username,ip))}
 return {check,fail,success};
}
