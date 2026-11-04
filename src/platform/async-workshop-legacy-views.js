import {createHash} from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const positive=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};
const bound=(value,defaultValue=50)=>{const n=value==null||value===''?defaultValue:Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Limite de página inválido');return Math.min(n,100);};
const date=(v,label)=>{const n=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(n))fail(label+' inválida');return new Date(n).toISOString();};
function cursorSignature(kind,options){return createHash('sha256').update(JSON.stringify([kind,options])).digest('hex').slice(0,16);}
function unpackCursor(value,signature){
 if(value==null||value==='')return null;
 if(typeof value!=='string'||value.length>512||!/^[A-Za-z0-9_-]+$/.test(value))fail('Cursor inválido');
 let row;try{row=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{fail('Cursor inválido');}
 if(row.v!==1||row.s!==signature||!Number.isSafeInteger(row.i)||row.i<1||
    (row.k!==undefined&&(typeof row.k!=='string'||row.k.length>512)))fail('Cursor inválido');
 return row;
}
const nextCursor=(row,signature,key)=>Buffer.from(JSON.stringify({
 v:1,s:signature,i:Number(row.id),...(key==null?{}:{k:key})
})).toString('base64url');

export function createAsyncLegacyViews(port,services){
 const statuses=['ENTRADA','DIAGNOSTICO','ORCAMENTO','AGUARDANDO_APROVACAO','APROVADA',
  'EM_SERVICO','PRONTA','ENTREGUE','CANCELADA','REPROVADA','TRANSFERIDA'];
 const groups={entrada:['ENTRADA'],diagnostico:['DIAGNOSTICO','ORCAMENTO'],
  aprovacao:['AGUARDANDO_APROVACAO','APROVADA'],servico:['EM_SERVICO'],pronta:['PRONTA']};
 async function getCustomer(id){
  const row=await port.first('SELECT * FROM customers WHERE id=?',[positive(id)]);
  if(!row)fail('Cliente não encontrado',404);
  return row;
 }
 async function getMachine(id){
  const row=await port.first('SELECT * FROM machines WHERE id=?',[positive(id)]);
  if(!row)fail('Máquina não encontrada',404);
  return row;
 }
 async function getCompanySettings(){
  return port.first('SELECT * FROM company_settings WHERE id=1');
 }
 async function updateCompanySettings(input={}){
  const current=await getCompanySettings();
  if(!current)fail('Configuração da empresa não inicializada',409);
  const clean=(value,max)=>{const s=String(value??'').trim();if(s.length>max)fail('Campo da empresa excede limite');return s;};
  const select=(key,col,max)=>input[key]===undefined?current[col]:clean(input[key],max);
  const profile=input.serviceProfile===undefined?current.service_profile:String(input.serviceProfile);
  if(!['MISTA','AUTOMOTIVA','AGRICOLA'].includes(profile))fail('Perfil da empresa inválido');
  const name=select('name','name',160);
  if(!name)fail('Nome da empresa obrigatório');
  await port.run(`UPDATE company_settings SET
    name=?,document=?,phone=?,email=?,address=?,service_profile=?,updated_at=? WHERE id=1`,[
    name,select('document','document',32),select('phone','phone',32),
    select('email','email',160),select('address','address',500),
    profile,new Date().toISOString()
  ]);
  return getCompanySettings();
 }
 async function listCustomersPage({search='',includeInactive=false,limit=50,cursor=null}={}){
  const size=bound(limit),q='%'+String(search).trim()+'%',active=includeInactive?1:0;
  const signature=cursorSignature('customers',{search:String(search),includeInactive});
  const after=unpackCursor(cursor,signature);
  const args=[active,q,q,q];
  let sql=`FROM customers c WHERE (?=1 OR c.active=1)
   AND (c.name LIKE ? OR c.document LIKE ? OR c.phone LIKE ?)`;
  if(after){sql+=' AND (LOWER(c.name)>? OR (LOWER(c.name)=? AND c.id>?))';
   args.push(after.k,after.k,after.i);}
  const rows=await port.all('SELECT c.* '+sql+' ORDER BY LOWER(c.name) ASC,c.id ASC LIMIT ?',
    [...args,size+1]);
  const total=await port.first(`SELECT COUNT(*) n FROM customers c
   WHERE (?=1 OR c.active=1) AND (c.name LIKE ? OR c.document LIKE ? OR c.phone LIKE ?)`,
   [active,q,q,q]);
  const hasMore=rows.length>size,items=rows.slice(0,size);
  return {items,total:Number(total.n),nextCursor:hasMore?
   nextCursor(items.at(-1),signature,String(items.at(-1).name).toLowerCase()):null};
 }
 async function listMachinesPage({customerId=null,search='',includeInactive=false,limit=50,cursor=null}={}){
  const size=bound(limit),active=includeInactive?1:0;
  const q='%'+String(search).trim()+'%',args=[active];
  let where='(?=1 OR m.active=1)';
  if(customerId!=null&&customerId!==''){where+=' AND m.customer_id=?';args.push(positive(customerId));}
  if(String(search).trim()){
   where+=` AND (m.type LIKE ? OR m.brand LIKE ? OR m.model LIKE ?
    OR m.serial_number LIKE ? OR m.license_plate LIKE ? OR m.vin LIKE ?
    OR m.renavam LIKE ? OR m.engine LIKE ? OR c.name LIKE ?)`;
   args.push(...Array(9).fill(q));
  }
  const signature=cursorSignature('machines',{customerId,search:String(search),includeInactive});
  const after=unpackCursor(cursor,signature);
  const from='FROM machines m JOIN customers c ON c.id=m.customer_id';
  const total=await port.first('SELECT COUNT(*) n '+from+' WHERE '+where,args);
  const filters=after?where+' AND m.id<?':where;
  const rows=await port.all('SELECT m.*,c.name customer_name '+from+' WHERE '+filters+
    ' ORDER BY m.id DESC LIMIT ?',[...args,...(after?[after.i]:[]),size+1]);
  const hasMore=rows.length>size,items=rows.slice(0,size);
  return {items,total:Number(total.n),nextCursor:hasMore?nextCursor(items.at(-1),signature):null};
 }
 async function getDashboard({role='ADMIN',now=new Date()}={}){
  const today=new Date(now),start=new Date(today.getFullYear(),today.getMonth(),1),
   next=new Date(today.getFullYear(),today.getMonth()+1,1);
  const grouped=await port.all('SELECT status,COUNT(*) n FROM work_orders GROUP BY status');
  const counts=Object.fromEntries(statuses.map(x=>[x,0]));
  for(const item of grouped)if(Object.hasOwn(counts,item.status))counts[item.status]=Number(item.n);
  counts.ABERTAS=statuses.filter(x=>!['ENTREGUE','CANCELADA','REPROVADA','TRANSFERIDA'].includes(x))
   .reduce((n,x)=>n+counts[x],0);
  const board={};
  for(const [key,group] of Object.entries(groups)){
   const ids=group.map(()=>'?').join(',');
   const count=group.reduce((n,x)=>n+counts[x],0);
   const items=await port.all(`SELECT wo.id,wo.os_number,wo.status,wo.problem_reported,
     c.name customer_name,m.brand machine_brand,m.model machine_model
     FROM work_orders wo JOIN customers c ON c.id=wo.customer_id
     JOIN machines m ON m.id=wo.machine_id
     WHERE wo.status IN (`+ids+`) ORDER BY wo.id DESC LIMIT 4`,group);
   board[key]={count,items};
  }
  const delivered=await port.first(`SELECT COUNT(*) n FROM work_orders
    WHERE status='ENTREGUE' AND delivered_at>=? AND delivered_at<?`,
    [start.toISOString(),next.toISOString()]);
  counts.ENTREGUES_MES=Number(delivered.n);
  const lowStock=await services.lowStockParts();
  counts.ESTOQUE_CRITICO=lowStock.length;
  const upcoming=await services.listSchedule({from:today.toISOString(),
    to:new Date(today.getTime()+30*86400000).toISOString(),limit:8});
  const maintenanceAlerts=await services.listMaintenanceAlerts({limit:8});
  const finance=['ADMIN','FINANCEIRO'].includes(role)
    ?await services.financeSummary({from:start.toISOString(),to:new Date(next.getTime()-1).toISOString()}):null;
  return {...(finance?{finance}:{}),counts,board,upcoming,lowStock,maintenanceAlerts};
 }
 async function getOperationalReport({from,to,includeFinance=true}={}){
  const current=new Date(),begin=date(from||new Date(current.getFullYear(),current.getMonth(),1).toISOString(),'Data inicial'),
   end=date(to||new Date(current.getFullYear(),current.getMonth()+1,1).toISOString(),'Data final');
  if(begin>=end)fail('Período inválido');
  const rows=await port.all('SELECT status,COUNT(*) n FROM work_orders GROUP BY status');
  const statusCounts=Object.fromEntries(rows.map(r=>[r.status,Number(r.n)]));
  const totalCount=rows.reduce((sum,r)=>sum+Number(r.n),0);
  const openCount=rows.filter(r=>!['ENTREGUE','CANCELADA','REPROVADA','TRANSFERIDA'].includes(r.status))
   .reduce((sum,r)=>sum+Number(r.n),0);
  const delivered=await port.first(`SELECT COUNT(*) n FROM work_orders
    WHERE status='ENTREGUE' AND delivered_at>=? AND delivered_at<?`,[begin,end]);
  const low=await port.first(`SELECT COUNT(*) n FROM parts
    WHERE active=1 AND quantity<=min_stock`);
  const finance=includeFinance?await services.financeSummary({
   from:begin,to:new Date(Date.parse(end)-1).toISOString()
  }):null;
  return {from:begin,to:end,totalCount,openCount,deliveredCount:Number(delivered.n),
    lowStockCount:Number(low.n),statusCounts,finance};
 }
 async function getCurrentCashSession(){
  return port.first("SELECT * FROM cash_sessions WHERE status='ABERTO' ORDER BY id DESC LIMIT 1");
 }
 async function listCashSessions(){
  return port.all('SELECT * FROM cash_sessions ORDER BY id DESC LIMIT 100');
 }
 return Object.freeze({getCustomer,getMachine,getCompanySettings,updateCompanySettings,
  listCustomersPage,listMachinesPage,getDashboard,getOperationalReport,
  getCurrentCashSession,listCashSessions});
}
