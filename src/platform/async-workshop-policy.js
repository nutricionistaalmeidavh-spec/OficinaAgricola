// Explicit permission boundary for the native PostgreSQL/D1 tenant API.
// The service Bearer token authenticates the gateway, never the end user.
const ALL=['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO'];
const OFFICE=['ADMIN','ATENDIMENTO'];
const TECH=['ADMIN','ATENDIMENTO','TECNICO'];
const FINANCE=['ADMIN','FINANCEIRO'];
const SALES=['ADMIN','ATENDIMENTO','FINANCEIRO'];
const ADMIN=['ADMIN'];
const SERVICE_ROUTES=new Set([
 '/v1/health','/v1/migrate','/v1/auth/bootstrap','/v1/auth/login',
 '/v1/auth/users','/v1/auth/logout','/v1/internal/gateway-session'
]);
export function serviceOnlyNativeRoute(path){
 return SERVICE_ROUTES.has(path)||/^\/v1\/public\/approval\/[a-f0-9]{64}$/.test(path);
}
export function requiredNativeRoles(method,path){
 const verb=String(method||'').toUpperCase();
 const route=String(path||'');
 if(serviceOnlyNativeRoute(route))return [];
 if(route==='/v1/company'&&verb!=='GET')return ADMIN;
 if(/^\/v1\/fiscal\/(?:onboarding|certificate|diagnose)$/.test(route))return ADMIN;
 if(/^\/v1\/fiscal\/[1-9][0-9]*\/review$/.test(route))return ADMIN;
 if(/^\/v1\/fiscal\/settings$/.test(route))return verb==='GET'?FINANCE:ADMIN;
 if(/^\/v1\/fiscal\/(?:\d+\/(?:submit|reconcile))$/.test(route))return FINANCE;
 if(/^\/v1\/(?:fiscal|reports\/finance)(?:\/|$)/.test(route))return FINANCE;
 if(/^\/v1\/(?:billing|payments|payment-intents|expenses)(?:\/|$)/.test(route))return FINANCE;
 if(/^\/v1\/cash(?:\/|$)/.test(route))return SALES;
 if(/^\/v1\/sales\/[1-9][0-9]*\/cancel$/.test(route))return FINANCE;
 if(/^\/v1\/sales(?:\/|$)/.test(route))return SALES;
 if(/^\/v1\/orders\/\d+\/(?:receipts|payment)(?:\/|$)/.test(route))return verb==='GET'?ALL:FINANCE;
 if(verb==='GET'||verb==='HEAD')return ALL;
 if(/^\/v1\/technicians(?:\/|$)/.test(route))return verb==='GET'?ALL:ADMIN;
 if(/^\/v1\/crm\/maintenance\/sync$/.test(route))return OFFICE;
 if(route==='/v1/checklist-templates'&&verb==='POST')return ADMIN;
 if(/^\/v1\/stock(?:\/|$)/.test(route))return OFFICE;
 if(/^\/v1\/(?:maintenance-plans|machines\/\d+\/(?:obd-scans|maintenance|maintenance-plans)|orders\/\d+\/(?:status|parts)|schedule)(?:\/|$)/.test(route))return TECH;
 return OFFICE;
}
