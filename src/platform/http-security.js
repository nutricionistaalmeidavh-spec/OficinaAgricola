// Camada compartilhada para HTTP local e HTTPS LAN. Sem token em JS
// no modo navegador; automações legadas ainda podem usar Bearer.
export function sessionTokenFrom(req){
 const auth=String(req.headers.authorization||'');
 if(auth.startsWith('Bearer '))return auth.slice(7).trim();
 const cookie=String(req.headers.cookie||'').split(';')
   .map(v=>v.trim()).find(v=>v.startsWith('oficina_session='));
 if(!cookie)return null;
 try{return decodeURIComponent(cookie.slice('oficina_session='.length))}catch{return null}
}
export function sessionCookie(req,token,{clear=false}={}){
 const tls=Boolean(req.socket?.encrypted);
 const parts=[
   'oficina_session='+encodeURIComponent(clear?'':token),
   'Path=/','HttpOnly','SameSite=Strict',clear?'Max-Age=0':'Max-Age=43200'
 ];
 if(tls)parts.push('Secure');
 return parts.join('; ');
}
export function assertTrustedOrigin(req){
 if(!['POST','PUT','PATCH','DELETE'].includes(req.method||''))return;
 const origin=req.headers.origin;
 if(!origin)return; // APIs locais sem Origin usam token Bearer.
 const host=String(req.headers.host||'');
 const scheme=req.socket?.encrypted?'https:':'http:';
 let parsed;
 try{parsed=new URL(String(origin))}catch{}
 if(!parsed||parsed.host!==host||parsed.protocol!==scheme){
   const error=new Error('Origem da requisição não autorizada');
   error.statusCode=403;
   throw error;
 }
}
export function setSecurityHeaders(res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}
