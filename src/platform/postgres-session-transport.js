// Cookie session parity for the existing web UI, with Bearer retained for API clients.
// Tokens are only parsed server-side; never persist them in browser storage.
const COOKIE='oficina_session';
const TOKEN=/^[A-Za-z0-9_-]{32,512}$/;
const mutating=new Set(['POST','PUT','PATCH','DELETE']);
const forbidden=()=>{throw Object.assign(new Error('Origem não autorizada'),{status:403});};

export function readPostgresSessionToken(request){
 const auth=String(request.headers.get('authorization')??'');
 if(auth.startsWith('Bearer ')){
  const value=auth.slice(7).trim();
  return TOKEN.test(value)?value:null;
 }
 for(const part of String(request.headers.get('cookie')??'').split(';')){
  const entry=part.trim(),separator=entry.indexOf('=');
  if(separator<0||entry.slice(0,separator)!==COOKIE)continue;
  try{
   const value=decodeURIComponent(entry.slice(separator+1));
   return TOKEN.test(value)?value:null;
  }catch{return null;}
 }
 return null;
}
export function hasPostgresCookieSession(request){
 return !String(request.headers.get('authorization')??'').startsWith('Bearer ')&&
  String(request.headers.get('cookie')??'').split(';')
   .some(x=>x.trim().startsWith(COOKIE+'='));
}
export function assertPostgresSameOrigin(request){
 if(!mutating.has(request.method.toUpperCase()))return;
 const origin=String(request.headers.get('origin')??'');
 const fetchSite=String(request.headers.get('sec-fetch-site')??'');
 if(fetchSite==='cross-site')forbidden();
 if(hasPostgresCookieSession(request)){
  if(!origin||origin!==new URL(request.url).origin)forbidden();
 }else if(origin&&origin!==new URL(request.url).origin)forbidden();
}
export function postgresBrowserCookie(request,token,{clear=false}={}){
 const value=clear?'':encodeURIComponent(token);
 const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
 return COOKIE+'='+value+'; Path=/api; HttpOnly; SameSite=Strict; Max-Age='+
  (clear?'0':'43200')+secure;
}
