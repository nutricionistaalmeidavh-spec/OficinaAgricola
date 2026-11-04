// Explicit permission boundary for the native PostgreSQL/D1 tenant API.
// The service Bearer token authenticates the gateway, never the end user.
const ALL=['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO'];
const OFFICE=['ADMIN','ATENDIMENTO'];
const TECH=['ADMIN','ATENDIMENTO','TECNICO'];
const FINANCE=['ADMIN','FINANCEIRO'];
const ADMIN=['ADMIN'];
const SERVICE_ROUTES=new Set([
 '/v1/health','/v1/migrate','/v1/auth/bootstrap','/v1/auth/login',
 '/v1/auth/users','/v1/auth/logout'
]);
export function serviceOnlyNativeRoute(path){
 return SERVICE_ROUTES.has(path);
}
export function requiredNativeRoles(method,path){
 const verb=String(method||'').toUpperCase();
 const route=String(path||'');
 if(serviceOnlyNativeRoute(route))return [];
 if(/^\/v1\/fiscal\/settings$/.test(route))return verb==='GET'?FINANCE:ADMIN;
 if(/^\/v1\/fiscal\/(?:\d+\/(?:submit|reconcile))$/.test(route))return ADMIN;
 if(/^\/v1\/(?:fiscal|reports\/finance)(?:\/|$)/.test(route))return FINANCE;
 if(/^\/v1\/(?:payments|expenses|cash|sales)(?:\/|$)/.test(route))return FINANCE;
 if(/^\/v1\/orders\/\d+\/(?:receipts|payment)(?:\/|$)/.test(route))return FINANCE;
 if(verb==='GET'||verb==='HEAD')return ALL;
 if(/^\/v1\/(?:technicians|crm\/maintenance\/sync)(?:\/|$)/.test(route))return ADMIN;
 if(/^\/v1\/stock(?:\/|$)/.test(route))return ['ADMIN','TECNICO'];
 if(/^\/v1\/(?:maintenance-plans|machines\/\d+\/(?:obd-scans|maintenance|maintenance-plans)|orders\/\d+\/(?:status|parts))(?:\/|$)/.test(route))return TECH;
 return OFFICE;
}
