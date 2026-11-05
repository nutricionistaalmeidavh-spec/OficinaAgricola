import {readPostgresSessionToken,hasPostgresCookieSession,assertPostgresSameOrigin,postgresBrowserCookie} from './postgres-session-transport.js';
// PostgreSQL-only control plane for authenticated tenant administration.
// The operational /api/* compatibility gateway remains disabled until P3/P4.
const HEADERS={
 'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store',
 'x-content-type-options':'nosniff'
};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const json=(result,status=200)=>new Response(JSON.stringify(result),{status,headers:HEADERS});
const validId=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');
 return n;
};
async function parseJson(request){
 const ct=String(request.headers.get('content-type')??'').toLowerCase();
 if(!ct.startsWith('application/json'))fail('Corpo JSON obrigatório',415);
 if(Number(request.headers.get('content-length')??0)>16384)fail('JSON excede limite',413);
 const text=await request.text();
 if(Buffer.byteLength(text)>16384)fail('JSON excede limite',413);
 let value;
 try{value=JSON.parse(text);}catch{fail('JSON inválido');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Objeto JSON obrigatório');
 return value;
}
const authToken=request=>{
 const token=readPostgresSessionToken(request);
 if(!token)fail('Sessão inválida',401);
 return token;
};
export function createPostgresRegistryControlHandler({registry,allowAdminBootstrap=false}={}){
 if(!registry||typeof registry.validateSession!=='function'||typeof registry.listUserUnits!=='function')
   throw Error('Controle PostgreSQL exige registry nativo');
 return async function handle(request,{remoteAddress='unknown'}={}){
  try{
   assertPostgresSameOrigin(request);
   const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
   if(path==='/api/health'&&method==='GET')
     return json({ok:true,mode:'postgres-registry',operationalApiReady:false});
   if(path==='/api/setup/status'&&method==='GET')
     return json({required:await registry.setupRequired()});
   if(path==='/api/setup/initialize'&&method==='POST'){
     if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))fail('Configure o primeiro administrador na máquina principal',403);
     if(!allowAdminBootstrap)fail('Inicialização administrativa não autorizada no processo',403);
     const input=await parseJson(request);
     return json(await registry.bootstrapAdmin(input));
   }
   if(path==='/api/auth/login'&&method==='POST'){
     const input=await parseJson(request);
     const login=await registry.login({...input,remoteAddress});
     if(!(await registry.listUserUnits(login.user.id)).length){
       await registry.logout(login.token);
       fail('Permissão: usuário sem vínculo com oficina',403);
     }
     if(String(request.headers.get('x-session-transport')??'').toLowerCase()==='cookie'){
       const response=json({user:login.user,expiresAt:login.expiresAt});
       response.headers.set('set-cookie',postgresBrowserCookie(request,login.token));
       return response;
     }
     return json(login);
   }
   const token=authToken(request);
   const user=await registry.validateSession(token);
   if(path==='/api/auth/logout'&&method==='POST'){
     await registry.logout(token);
     const response=json({ok:true});
     if(hasPostgresCookieSession(request))
       response.headers.set('set-cookie',postgresBrowserCookie(request,null,{clear:true}));
     return response;
   }
   const units=async()=>{
     const all=await registry.listUserUnits(user.id);
     if(!all.length)fail('Permissão: usuário sem vínculo',403);
     return all;
   };
   const selectedUnit=async()=>{
     const available=await units();
     const header=String(request.headers.get('x-oficina-unit')??'');
     if(!header){
       if(available.length!==1)fail('Selecione uma oficina para continuar',409);
       return registry.requireUnitMembership(user.id,available[0].id);
     }
     return registry.requireUnitMembership(user.id,validId(header));
   };
   if(path==='/api/auth/me'&&method==='GET'){
     const unit=await selectedUnit();
     return json({...user,role:unit.role});
   }
   if(path==='/api/tenancy/context'&&method==='GET'){
     return json({units:await units(),platformAdmin:await registry.isPlatformAdmin(user.id)});
   }
   if(path==='/api/tenancy/companies'&&method==='POST')
     return json(await registry.createCompany(user.id,await parseJson(request)),201);
   if(path==='/api/tenancy/units'&&method==='POST')
     return json(await registry.createUnit(user.id,await parseJson(request)),201);
   if(path==='/api/tenancy/memberships'&&method==='GET')
     return json(await registry.listUnitMembers(user.id,validId(url.searchParams.get('unitId'))));
   if(path==='/api/tenancy/memberships'&&method==='POST')
     return json(await registry.grantMembership(user.id,await parseJson(request)),201);
   if(path==='/api/tenancy/memberships'&&method==='PATCH')
     return json(await registry.changeMembership(user.id,await parseJson(request)));
   if(path==='/api/tenancy/audit'&&method==='GET')
     return json(await registry.listAudit(user.id,validId(url.searchParams.get('companyId'))));
   if(path==='/api/users'&&method==='GET'){
     const unit=await selectedUnit();
     return json(await registry.listUnitMembers(user.id,unit.id));
   }
   if(path==='/api/users'&&method==='POST'){
     const unit=await selectedUnit();
     return json(await registry.grantMembership(user.id,{...await parseJson(request),unitId:unit.id}),201);
   }
   const match=path.match(/^\/api\/users\/([1-9][0-9]*)$/);
   if(match&&method==='PATCH'){
     const unit=await selectedUnit();
     return json(await registry.changeMembership(user.id,{...await parseJson(request),unitId:unit.id,userId:validId(match[1])}));
   }
   if(path==='/api/units'&&method==='GET'){
     const unit=await selectedUnit();
     const visible=(await units()).filter(x=>x.companyId===unit.companyId);
     return json(visible.map(x=>({id:x.id,code:x.code,name:x.name,active:1})));
   }
   if(path==='/api/units'&&method==='POST'){
     const unit=await selectedUnit();
     return json(await registry.createUnit(user.id,{...await parseJson(request),companyId:unit.companyId}),201);
   }
   // No unsupported operational route may fall through to SQLite.
   return json({error:'Rota operacional ainda não migrada para PostgreSQL'},501);
  }catch(error){
   const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599
     ?error.status:500;
   return json({error:status===500?'Erro interno no controle PostgreSQL':error.message},status);
  }
 };
}
