// Guardas fiscais determinísticas. O enquadramento é informado pelo responsável;
// este módulo valida consistência, jamais escolhe NCM/CFOP/CST ou alíquotas.
const fail=message=>{throw new Error(message);};
const string=v=>String(v??'').trim();
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
export function validateReviewedTaxItems({issuer={},sections={},lines=[]}={}){
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
  calculation(icms,'vBC','pICMS','vICMS','ICMS do item '+suffix);
  for(const [name,part,rateKey,valueKey] of [
   ['PIS',pis,'pPIS','vPIS'],['COFINS',cofins,'pCOFINS','vCOFINS']
  ]){
   whole(part.CST,name+' CST do item '+suffix,/^\d{2}$/);
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
  // A apuração geral é segura apenas para o CST 000 nesta fase.
  // Regimes reduzidos, monofásicos e diferidos exigem regra legal própria.
  if(cst!=='000')fail('IBS/CBS exige revisão especializada para CST '+cst);
  const bc=amount(base.vBC,'IBS/CBS base do item '+suffix);
  const validateSub=(part,percentKey,valueKey,label)=>{
   const p=rate(part[percentKey],label+' alíquota');
   const v=amount(part[valueKey],label+' valor');
   if(Math.abs(Math.round(bc*p/100)-v)>1)fail(label+' valor diverge do cálculo revisado');
   return v;
  };
  const vu=validateSub(uf,'pIBSUF','vIBSUF','IBS UF');
  const vm=validateSub(mun,'pIBSMun','vIBSMun','IBS Município');
  validateSub(cbs,'pCBS','vCBS','CBS');
  if(Math.abs(amount(base.vIBS,'IBS total')-vu-vm)>1)
   fail('IBS total difere da soma UF + Município');
  for(const [name,part] of Object.entries({base,uf,mun,cbs})){
   if(Object.keys(part).some(k=>/^(?:pDif|vDif|pDevTrib|vDevTrib|pRedAliq|pAliqEfet)$/.test(k)))
    fail('IBS/CBS '+name+' com redução/diferimento requer revisão especializada');
  }
 }
 return true;
}
