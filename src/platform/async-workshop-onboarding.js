// Estado de primeiro acesso por unidade no banco canônico. Nunca é uma
// autorização fiscal, de homologação ou de transmissão em produção.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const OPTIONAL=new Set(['services','team','cash','printer','fiscal']);
const STEPS=Object.freeze([
 {key:'company',label:'Empresa e endereço',required:true},
 {key:'services',label:'Catálogo de serviços',required:false},
 {key:'team',label:'Técnicos e equipe',required:false},
 {key:'cash',label:'Caixa',required:false},
 {key:'printer',label:'Impressora',required:false},
 {key:'fiscal',label:'Fiscal (independente)',required:false}
]);
const stamp=()=>new Date().toISOString();
const parseKeys=(raw,allowed)=>{
 try{
  const values=JSON.parse(raw||'[]');
  return Array.isArray(values)?values.filter(x=>allowed.has(x)):[];
 }catch{return [];}
};
export function createAsyncWorkshopOnboarding(port,{certificateStatus=()=>({configured:false})}={}){
 if(!['postgres','d1','sqlite'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function currentState(){
  const row=await port.first('SELECT * FROM workshop_onboarding_state WHERE id=1');
  return {skipped:new Set(parseKeys(row?.skipped_json,OPTIONAL)),
   confirmed:new Set(parseKeys(row?.confirmed_json,new Set(['printer']))),
   finishedAt:row?.finished_at||null};
 }
 async function getStatus(){
  const [company,settings,services,team,cash,progress]=await Promise.all([
   port.first('SELECT name,address,document,service_profile FROM company_settings WHERE id=1'),
   port.first('SELECT enabled,environment,production_confirmed FROM fiscal_settings WHERE id=1'),
   port.first('SELECT COUNT(*) n FROM service_catalog WHERE active=1'),
   port.first('SELECT COUNT(*) n FROM technicians WHERE active=1'),
   port.first('SELECT COUNT(*) n FROM cash_sessions'),
   currentState()
  ]);
  if(!company||!settings)fail('Instalação não inicializada',503);
  const companyComplete=Boolean(company.name?.trim()&&
   company.name.trim()!=='ArtiSys Oficina'&&company.address?.trim());
  let certificate={configured:false};
  try{certificate=await certificateStatus()||{configured:false};}
  catch{certificate={configured:false};}
  const fiscalConfigured=Boolean(settings.enabled),certificateConfigured=Boolean(certificate.configured);
  // Confirmação do operador e seleção de ambiente NÃO comprovam
  // credenciamento, autorização de UF/município ou nota em homologação.
  const fiscalState=fiscalConfigured&&certificateConfigured?'HOMOLOGACAO':'PENDENTE';
  const actual={company:companyComplete,services:Number(services.n)>0,
   team:Number(team.n)>0,cash:Number(cash.n)>0,
   printer:progress.confirmed.has('printer'),fiscal:false};
  const steps=STEPS.map(step=>({...step,complete:actual[step.key],
   skipped:!actual[step.key]&&progress.skipped.has(step.key)}));
  return {
   steps,readyToWork:companyComplete,finished:Boolean(progress.finishedAt&&companyComplete),
   finishedAt:progress.finishedAt,
   progress:steps.filter(s=>s.complete||s.skipped).length,
   total:steps.length,
   fiscalState,
   fiscal:{companyConfigured:fiscalConfigured,certificateConfigured,
    certificateType:certificateConfigured?certificate.certificateType||null:null,
    environment:settings.environment,productionRequested:Boolean(settings.production_confirmed),
    homologationVerified:false,authorizedForProduction:false},
   company:{name:company.name,address:company.address,document:company.document,
    serviceProfile:company.service_profile}
  };
 }
 async function setPreference({action,step}={}){
  if(!['skip','resume','confirm','finish','reopen'].includes(action))
   fail('Ação de primeiro acesso inválida');
  if(['skip','resume','confirm'].includes(action)&&!STEPS.some(s=>s.key===step))
   fail('Etapa de primeiro acesso inválida');
  if(action==='skip'&&!OPTIONAL.has(step))fail('Não é possível pular etapa obrigatória');
  if(action==='confirm'&&step!=='printer')fail('Confirmação manual não permitida para esta etapa');
  const state=await currentState();
  if(action==='skip'){state.skipped.add(step);state.confirmed.delete(step);}
  if(action==='resume'){state.skipped.delete(step);state.confirmed.delete(step);}
  if(action==='confirm'){state.skipped.delete(step);state.confirmed.add(step);}
  if(action==='finish'){
   if(!(await getStatus()).readyToWork)fail('Complete os dados da empresa antes de começar',409);
   state.finishedAt=stamp();
  }
  if(action==='reopen')state.finishedAt=null;
  const at=stamp();
  await port.run(`INSERT INTO workshop_onboarding_state(
    id,skipped_json,confirmed_json,finished_at,updated_at
   ) VALUES(1,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET skipped_json=excluded.skipped_json,
    confirmed_json=excluded.confirmed_json,finished_at=excluded.finished_at,
    updated_at=excluded.updated_at`,[
   JSON.stringify([...state.skipped]),JSON.stringify([...state.confirmed]),state.finishedAt,at
  ]);
  return getStatus();
 }
 async function runDiagnostics(){
  const row=await port.first('SELECT 1 AS ok');
  const status=await getStatus();
  return {database:{ok:Number(row?.ok)===1,engine:port.engine},
   company:{ok:status.readyToWork},
   fiscal:{...status.fiscal,status:status.fiscalState},
   checkedAt:stamp(),
   warning:'Diagnóstico local não substitui homologação real SEFAZ/NFS-e nem libera produção.'};
 }
 return Object.freeze({getStatus,setPreference,runDiagnostics});
}
