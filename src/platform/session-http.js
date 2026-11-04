// Sessão HTTP: cookie HttpOnly para o navegador; Bearer preservado para clientes API legados.
const sessionName='oficina_session';
const mutating=new Set(['POST','PUT','PATCH','DELETE']);
export function loopbackAddress(address){
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(address||''));
}
export function authTokenFrom(req){
 const header=String(req.headers?.authorization||'');
 if(header.startsWith('Bearer '))return header.slice(7).trim();
 const cookies=String(req.headers?.cookie||'').split(';');
 for(const item of cookies){
   const [name,...value]=item.trim().split('=');
   if(name===sessionName)return decodeURIComponent(value.join('='));
 }
 return null;
}
export function isCookieSession(req){
 return !String(req.headers?.authorization||'').startsWith('Bearer ')&&
   String(req.headers?.cookie||'').split(';').some(c=>c.trim().startsWith(sessionName+'='));
}
export function assertSameOrigin(req){
 if(!mutating.has(req.method||'GET')||!isCookieSession(req))return;
 const fetchSite=String(req.headers['sec-fetch-site']||'');
 if(fetchSite==='cross-site')throw new Error('Origem não autorizada');
 const origin=req.headers.origin;
 const host=String(req.headers.host||'');
 const protocol=req.socket?.encrypted?'https:':'http:';
 // Requisições de browser precisam comprovar a origem; nunca confiar só no cookie.
 if(!origin||!host)throw new Error('Origem não autorizada');
 let actual;
 try{actual=new URL(origin)}catch{throw new Error('Origem não autorizada')}
 if(actual.protocol!==protocol||actual.host!==host)throw new Error('Origem não autorizada');
}
export function prefersCookie(req){
 return String(req.headers?.['x-session-transport']||'').toLowerCase()==='cookie';
}
export function issueBrowserCookie(res,req,token){
 const secure=req.socket?.encrypted?'; Secure':'';
 res.setHeader('Set-Cookie',`${sessionName}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`);
}
export function clearBrowserCookie(res,req){
 const secure=req.socket?.encrypted?'; Secure':'';
 res.setHeader('Set-Cookie',`${sessionName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}
export function hardenHttpResponse(res,req){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'");
 if(req.socket?.encrypted)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
