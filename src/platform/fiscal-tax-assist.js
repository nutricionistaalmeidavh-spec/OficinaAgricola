import {validateFiscalClassification} from './fiscal-official-catalog.js';

// Guardas fiscais determinísticas. O enquadramento é informado pelo responsável;
// este módulo valida consistência, jamais escolhe NCM/CFOP/CST ou alíquotas.
const fail=message=>{throw new Error(message);};
const string=v=>String(v??'').trim();
const CSOSN_CODES=new Set(['101','102','103','201','202','203','300','400','500','900']);
const ICMS_CST_CODES=new Set(['00','10','20','30','40','41','50','51','60','70','90']);
const PIS_COFINS_CODES=new Set([
 '01','02','03','04','05','06','07','08','09','49',
 '50','51','52','53','54','55','56','60','61','62','63','64','65','66','67',
 '70','71','72','73','74','75','98','99'
]);
const amount=(value,label)=>{
 const s=string(value);
 if(!/^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(s))fail(label+' deve estar em reais com duas casas');
 return Number(s.replace('.',''));
};
const rate=(value,label)=>{
 const s=string(value);
 if(!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/.test(s)||Number(s)>100)
   fail(label+' deve estar entre 0 e 100%');
 return Number(s);
};
const whole=(value,label,regex)=>{
 if(!regex.test(string(value)))fail(label+' inválido');
 return string(value);
};
function calculation(group,baseName,rateName,amountName,label){
 const provided=[baseName,rateName,amountName].filter(key=>group[key]!==undefined&&string(group[key])!=='');
 if(!provided.length)return;
 if(provided.length!==3)fail(label+' incompleto: base, alíquota e valor são obrigatórios em conjunto');
 const base=amount(group[baseName],label+' base');
 const percent=rate(group[rateName],label+' alíquota');
 const result=amount(group[amountName],label+' valor');
 if(Math.abs(Math.round(base*percent/100)-result)>1)
   fail(label+' valor diverge do cálculo revisado');
}
export function validateReviewedTaxItems({issuer={},sections={},lines=[],catalog=null}={}){
 if(!Array.isArray(lines)||lines.length<1||lines.length>100)fail('Itens comerciais inválidos');
 const regime=string(issuer.taxRegime).toUpperCase();
 if(regime&&!['MEI','SIMPLES','NORMAL'].includes(regime))fail('Regime tributário do emitente inválido');
 const idDest=string(sections.Identificacao?.idDest);
 for(let index=0;index<lines.length;index++){
  const suffix=String(index+1).padStart(3,'0');
  const item=sections['Produto'+suffix],icms=sections['ICMS'+suffix],
    pis=sections['PIS'+suffix],cofins=sections['COFINS'+suffix];
  if(!item||!icms||!pis||!cofins)
    fail('Tributação ICMS/PIS/COFINS incompleta no item '+suffix);
  whole(item.NCM,'NCM do item '+suffix,/^\d{8}$/);
  if(catalog)validateFiscalClassification({catalog,ncm:item.NCM,cfop:item.CFOP});
  else if(issuer.environment==='PRODUCAO')
    fail('Catálogo fiscal oficial local obrigatório antes de transmitir em produção');
  const cfop=whole(item.CFOP,'CFOP do item '+suffix,/^[567]\d{3}$/);
  if(idDest==='1'&&!cfop.startsWith('5')||
     idDest==='2'&&!cfop.startsWith('6')||
     idDest==='3'&&!cfop.startsWith('7'))
    fail('CFOP incompatível com destino indicado no item '+suffix);
  whole(icms.orig,'Origem ICMS do item '+suffix,/^[0-8]$/);
  if(regime==='MEI'||regime==='SIMPLES'){
   whole(icms.CSOSN,'CSOSN ICMS do item '+suffix,/^\d{3}$/);
   if(icms.CST!==undefined)fail('CSOSN e CST ICMS não podem coexistir no Simples');
  }else if(regime==='NORMAL'){
   whole(icms.CST,'CST ICMS do item '+suffix,/^\d{2}$/);
   if(icms.CSOSN!==undefined)fail('CST e CSOSN não podem coexistir no regime Normal');
  }else{
   if(icms.CST===undefined&&icms.CSOSN===undefined)
     fail('Informe CST ICMS ou CSOSN no item '+suffix);
   if(icms.CST!==undefined)whole(icms.CST,'CST ICMS',/^\d{2}$/);
   if(icms.CSOSN!==undefined)whole(icms.CSOSN,'CSOSN ICMS',/^\d{3}$/);
  }
  if(regime==='NORMAL'&&string(icms.CST)==='00'&&
    ['vBC','pICMS','vICMS'].some(k=>string(icms[k])===''))
    fail('ICMS do item '+suffix+' exige base, alíquota e valor completos');
  if(icms.CSOSN!==undefined&&!CSOSN_CODES.has(string(icms.CSOSN)))
    fail('CSOSN ICMS não reconhecido no item '+suffix);
  if(icms.CST!==undefined&&!ICMS_CST_CODES.has(string(icms.CST)))
    fail('CST ICMS não reconhecido no item '+suffix);
  calculation(icms,'vBC','pICMS','vICMS','ICMS do item '+suffix);
  for(const [name,part,rateKey,valueKey] of [
   ['PIS',pis,'pPIS','vPIS'],['COFINS',cofins,'pCOFINS','vCOFINS']
  ]){
   const cstValue=whole(part.CST,name+' CST do item '+suffix,/^\d{2}$/);
   if(!PIS_COFINS_CODES.has(cstValue))
     fail(name+' CST não reconhecido no item '+suffix);
   if(['01','02'].includes(cstValue)&&
      ['vBC',rateKey,valueKey].some(k=>string(part[k])===''))
     fail(name+' do item '+suffix+' requer base, alíquota e valor completos');
   calculation(part,'vBC',rateKey,valueKey,name+' do item '+suffix);
  }
  const ibs=sections['IBSCBS'+suffix],base=sections['gIBSCBS'+suffix],
    uf=sections['gIBSUF'+suffix],mun=sections['gIBSMun'+suffix],
    cbs=sections['gCBS'+suffix];
  if(![ibs,base,uf,mun,cbs].some(Boolean))continue;
  if(![ibs,base,uf,mun,cbs].every(Boolean))
   fail('IBS/CBS incompleto no item '+suffix+'; revisão específica obrigatória');
  const cst=whole(ibs.CST,'IBS/CBS CST',/^\d{3}$/);
  const classe=whole(ibs.cClassTrib,'IBS/CBS cClassTrib',/^\d{6}$/);
  if(!classe.startsWith(cst))fail('IBS/CBS cClassTrib divergente do CST no item '+suffix);
  // Somente o catálogo versionado admite combinações CST x cClassTrib.
  const row=validateFiscalClassification({catalog,ncm:item.NCM,cfop:item.CFOP,
    cst,cClassTrib:classe});
  if(row.regime==='ESPECIAL')fail('Regime IBS/CBS especial exige integração específica e revisão');
  if(row.regime==='REDUCAO'&&!row.reduction||row.regime==='DIFERIMENTO'&&!row.deferral)
   fail('Indicadores da classificação não permitem redução/diferimento');
  const bc=amount(base.vBC,'IBS/CBS base do item '+suffix);
  const checkPart=(part,percentKey,valueKey,label)=>{
   const nominal=rate(part[percentKey],label+' alíquota');
   const reduction=part.pRedAliq!==undefined||part.pAliqEfet!==undefined;
   const deferral=part.pDif!==undefined||part.vDif!==undefined;
   if(row.regime==='REDUCAO'&&!reduction||row.regime==='DIFERIMENTO'&&!deferral)
     fail(label+' redução/diferimento incompleto para a classificação');
   if(reduction&&(!row.reduction||part.pRedAliq===undefined||part.pAliqEfet===undefined))
     fail(label+' redução não permitida ou incompleta');
   if(deferral&&(!row.deferral||part.pDif===undefined||part.vDif===undefined))
     fail(label+' diferimento não permitido ou incompleto');
   if(reduction&&deferral)
     fail(label+' combinação de redução com diferimento exige revisão específica');
   let effective=nominal;
   if(reduction){
     const red=rate(part.pRedAliq,label+' redução');
     const stated=rate(part.pAliqEfet,label+' alíquota efetiva');
     effective=Math.round(nominal*(1-red/100)*10000)/10000;
     if(Math.abs(stated-effective)>0.0001)
       fail(label+' alíquota efetiva incompatível com redução');
   }
   const gross=Math.round(bc*effective/100);
   let postponed=0;
   if(deferral){
     const p=rate(part.pDif,label+' percentual de diferimento');
     postponed=Math.round(gross*p/100);
     if(Math.abs(amount(part.vDif,label+' valor diferido')-postponed)>1)
       fail(label+' vDif diverge do diferimento revisado');
   }
   const total=amount(part[valueKey],label+' valor');
   if(Math.abs(gross-postponed-total)>1)
     fail(label+' valor diverge do cálculo revisado');
   if(Object.keys(part).some(k=>/^(?:vDevTrib|pDevTrib|vCredPres|pCredPres)$/.test(k)))
     fail(label+' créditos/devoluções exigem validação específica');
   return total;
  };
  const vu=checkPart(uf,'pIBSUF','vIBSUF','IBS UF');
  const vm=checkPart(mun,'pIBSMun','vIBSMun','IBS Município');
  checkPart(cbs,'pCBS','vCBS','CBS');
  const emissionYear=Number(String(sections.Identificacao?.dhEmi||'').match(/20\d{2}/)?.[0]||
    new Date().getFullYear());
  if(emissionYear===2026&&rate(mun.pIBSMun,'IBS municipal')!==0)
    fail('Em 2026 a alíquota IBS municipal informada deve ser 0');
  if(Math.abs(amount(base.vIBS,'IBS total')-vu-vm)>1)
    fail('IBS total difere da soma UF + Município');
 }
 return true;
}
