// Private service-to-service HTTP boundary for native async D1/PG operations.
// No arbitrary SQL endpoint, browser CORS allowance or client-side secrets.
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const constantTimeToken=(actual,expected)=>{
  if(typeof actual!=='string'||typeof expected!=='string')return false;
  let mismatch=actual.length^expected.length;
  const size=Math.max(actual.length,expected.length);
  for(let i=0;i<size;i++)mismatch|=(actual.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);
  return mismatch===0;
};
async function dataFrom(request){
 if(!String(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
   throw Object.assign(new Error('Corpo JSON obrigatório'),{status:415});
 if(Number(request.headers.get('content-length')||0)>1048576)
   throw Object.assign(new Error('Requisição excede limite'),{status:413});
 const raw=await request.text();
 if(raw.length>1048576)throw Object.assign(new Error('Requisição excede limite'),{status:413});
 let data;try{data=JSON.parse(raw);}catch{throw Object.assign(new Error('JSON inválido'),{status:400});}
 if(!data||typeof data!=='object'||Array.isArray(data))
   throw Object.assign(new Error('Objeto JSON obrigatório'),{status:400});
 return data;
}
export function createAsyncWorkshopHandler({services,serviceToken,migrate=null,preflight=null}={}){
 if(!services||typeof services!=='object')throw Error('Serviço SQL assíncrono indisponível');
 if(!serviceToken||String(serviceToken).length<32)
   throw Error('Token privado do backend SQL deve ter ao menos 32 caracteres');
 return async request=>{
  const authorized=constantTimeToken(request.headers.get('authorization')||'',
    'Bearer '+serviceToken);
  if(!authorized)return json({error:'Serviço privado: acesso não autorizado'},401);
  try{
   const u=new URL(request.url),path=u.pathname,method=request.method.toUpperCase();
   // Called only after private Bearer authentication and before ANY
   // operational query; prevents a wrongly mapped company from reading data.
   if(preflight&&path!=='/v1/migrate'&&path!=='/v1/health')
     await preflight();
   if(path==='/v1/health'&&method==='GET')
     return json({ok:true,backend:'async-workshop'});
   if(path==='/v1/migrate'&&method==='POST'&&migrate)
     return json(await migrate());
   if(path==='/v1/customers'&&method==='POST')
     return json(await services.createCustomer(await dataFrom(request)),201);
   if(path==='/v1/customers'&&method==='GET')
     return json(await services.listCustomers({
       search:u.searchParams.get('search')||'',
       includeInactive:u.searchParams.get('includeInactive')==='1',
       limit:u.searchParams.get('limit')||200,
       offset:u.searchParams.get('offset')||0
     }));
   const customer=path.match(/^\/v1\/customers\/([1-9]\d*)$/);
   if(customer&&method==='PATCH')
     return json(await services.updateCustomer(Number(customer[1]),await dataFrom(request)));
   if(path==='/v1/machines'&&method==='POST')
     return json(await services.createMachine(await dataFrom(request)),201);
   if(path==='/v1/machines'&&method==='GET')
     return json(await services.listMachines({
       customerId:u.searchParams.get('customerId')||null,
       search:u.searchParams.get('search')||'',
       includeInactive:u.searchParams.get('includeInactive')==='1'
     }));
   const machine=path.match(/^\/v1\/machines\/([1-9]\d*)$/);
   if(machine&&method==='PATCH')
     return json(await services.updateMachine(Number(machine[1]),await dataFrom(request)));
   if(path==='/v1/technicians'&&method==='GET')
     return json(await services.listTechnicians({includeInactive:true}));
   if(path==='/v1/technicians'&&method==='POST')
     return json(await services.createTechnician(await dataFrom(request)),201);
   if(path==='/v1/orders'&&method==='POST')
     return json(await services.createWorkOrder(await dataFrom(request)),201);
   const order=path.match(/^\/v1\/orders\/([1-9]\d*)$/);
   if(order&&method==='GET')
     return json(await services.getWorkOrder(Number(order[1])));
   const status=path.match(/^\/v1\/orders\/([1-9]\d*)\/status$/);
   if(status&&method==='POST')
     return json(await services.transitionWorkOrder({
       ...await dataFrom(request),workOrderId:Number(status[1])
     }));
   const quote=path.match(/^\/v1\/orders\/([1-9]\d*)\/quote$/);
   if(quote&&method==='PUT')
     return json(await services.saveQuote({
       ...await dataFrom(request),workOrderId:Number(quote[1])
     }));
   const approve=path.match(/^\/v1\/orders\/([1-9]\d*)\/quote\/approve$/);
   if(approve&&method==='POST')
     return json(await services.approveQuote({workOrderId:Number(approve[1])}));
   if(path==='/v1/fiscal/drafts'&&method==='POST')
     return json(await services.createFiscalDraft(await dataFrom(request)),201);

   if(path==='/v1/parts'&&method==='POST')
     return json(await services.createPart(await dataFrom(request)),201);
   if(path==='/v1/stock'&&method==='POST')
     return json(await services.postStockMovement(await dataFrom(request)),201);
   if(path==='/v1/payments'&&method==='POST')
     return json(await services.receivePayment(await dataFrom(request)),201);
   if(path==='/v1/reports/finance'&&method==='GET')
     return json(await services.financeSummary({
       from:u.searchParams.get('from')||undefined,to:u.searchParams.get('to')||undefined
     }));
   return json({error:'Rota interna não encontrada'},404);
  }catch(error){
   const status=[400,403,404,409,413,415,422].includes(error?.status)?error.status:500;
   return json({error:status===500?'Falha na operação SQL interna':error.message},status);
  }
 };
}
