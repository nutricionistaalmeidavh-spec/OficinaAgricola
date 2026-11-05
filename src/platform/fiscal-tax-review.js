// Tax classification is a human-reviewed input, not a tax advice engine.
// No guessed NCM/CFOP/CST/CSOSN, ISS rate, tax base or recipient identity.
import {createHash} from 'node:crypto';
import {FISCAL_UFS,assertFiscalIssuerUf} from './fiscal-uf.js';

const fail=(message)=>{throw new Error(message)};
const plain=(v,max=120)=>{const s=String(v??'').trim();if(!s||s.length>max||/[\x00-\x1f\x7f]/.test(s))fail('Campo tributário obrigatório, inválido ou muito longo');return s;};
const optional=(v,max=120)=>{const s=String(v??'').trim();if(s.length>max||/[\x00-\x1f\x7f]/.test(s))fail('Texto fiscal inválido');return s};
const match=(v,re,name)=>{const s=String(v??'').trim();if(!re.test(s))fail(name+' inválido');return s;};
const taxMoney=v=>match(v,/^(?:0|[1-9]\d{0,9})\.\d{2}$/,'Base/valor tributário');
const percentage=v=>{const text=match(v,/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/,'Alíquota');if(Number(text)>100)fail('Alíquota acima de 100%');return text;};
const id=v=>match(v,/^[a-zA-Z0-9_-]{3,64}$/,'Identificador do perfil');
const docDigits=v=>String(v??'').replace(/\D/g,'');
export function validateTaxProfile(input,{issuer}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Perfil tributário inválido');
 const kind=match(input.kind,/^(GOODS|SERVICE)$/,'Tipo de perfil');
 const name=plain(input.name,80),profileId=input.id==null?null:id(input.id);
 if(kind==='SERVICE'){
   const municipalityIbge=match(input.municipalityIbge,/^\d{7}$/,'Município IBGE');
   if(issuer?.municipalityIbge&&issuer.municipalityIbge!==municipalityIbge)
     fail('Regra de serviço não pertence ao município do emitente');
   const rate=percentage(input.issRate);
   return {kind,name,...(profileId?{id:profileId}:{}),
     municipalityIbge,serviceListCode:match(input.serviceListCode,/^\d{2}\.\d{2}$/,'Item da lista de serviço'),
     municipalServiceCode:match(input.municipalServiceCode,/^[A-Za-z0-9._/-]{1,25}$/,'Código municipal do serviço'),
     ...(input.nationalServiceCode?{nationalServiceCode:match(input.nationalServiceCode,/^\d{6}$/,'Código nacional de serviço')}:{}),
     ...(input.nbsCode?{nbsCode:match(input.nbsCode,/^\d{9}$/,'Código NBS')}:{}),
     cnae:match(input.cnae,/^\d{7}$/,'CNAE'),issRate:rate,
     withheld:input.withheld===true};
 }
 const ncm=match(input.ncm,/^\d{8}$/,'NCM');
 const cfop=match(input.cfop,/^[1-7]\d{3}$/,'CFOP');
 const origin=match(input.origin,/^[0-8]$/,'Origem ICMS');
 const scheme=match(input.icmsScheme,/^(CSOSN|CST)$/,'Regime ICMS (CST/CSOSN)');
 if(issuer?.taxRegime&&
   ((issuer.taxRegime==='NORMAL'&&scheme!=='CST')||
    (['MEI','SIMPLES'].includes(issuer.taxRegime)&&scheme!=='CSOSN')))
   fail('CST/CSOSN incompatível com o regime tributário');
 const icmsCode=scheme==='CST'
   ?match(input.icmsCode,/^(00|40|41|50)$/,'CST ICMS; situação avançada exige revisão específica')
   :match(input.icmsCode,/^(102|103|300|400)$/,'CSOSN; situação avançada exige revisão específica');
 const pisCst=match(input.pisCst,/^(01|02|04|05|06|07|08|09|49)$/,'CST PIS');
 const cofinsCst=match(input.cofinsCst,/^(01|02|04|05|06|07|08|09|49)$/,'CST COFINS');
 return {kind,name,...(profileId?{id:profileId}:{}),ncm,cfop,origin,
   icmsScheme:scheme,icmsCode,pisCst,cofinsCst,
   unit:match(input.unit,/^[A-Za-z0-9]{1,6}$/,'Unidade comercial').toUpperCase(),
   ...(input.cest?{cest:match(input.cest,/^\d{7}$/,'CEST')}:{}),
   ...(input.benefitCode?{benefitCode:match(input.benefitCode,/^[A-Za-z0-9]{1,20}$/,'Código de benefício')}:{}),
 };
}
function addressFields(prefix,values,{uf,municipalityIbge}={}){
 if(!values||typeof values!=='object'||Array.isArray(values))fail('Endereço fiscal '+prefix+' obrigatório');
 const place=match(values.zip,/^\d{8}$/,'CEP do '+prefix);
 const municipality=match(values.municipalityIbge??municipalityIbge,/^\d{7}$/,'Município IBGE do '+prefix);
 const state=match(values.uf??uf,/^[A-Z]{2}$/,'UF do '+prefix);
 if(FISCAL_UFS[state]&&municipality.slice(0,2)!==FISCAL_UFS[state].ibge)
   fail('UF e município divergem no endereço '+prefix);
 return {xLgr:plain(values.street,60),nro:plain(values.number,20),
   xBairro:plain(values.district,60),xMun:plain(values.city,60),
   cMun:municipality,UF:state,CEP:place,cPais:'1058',xPais:'BRASIL'};
}
function components(input,key,code){
 const value=input?.[key];
 if(!value||typeof value!=='object'||Array.isArray(value))
   fail('Tributação '+key+' exige base/alíquota/valor revisados');
 return {vBC:taxMoney(value.base),['p'+code]:percentage(value.rate),
   ['v'+code]:taxMoney(value.amount)};
}
export function assembleAssistedTaxReview({document,issuer,company,customer,issuance,items,profiles}={}){
 if(document?.status!=='RASCUNHO')fail('Somente rascunho fiscal permite revisão tributária');
 if(!['NFE','NFCE'].includes(document.kind))fail('NFS-e depende de regra municipal específica');
 if(!issuer?.cnpj||!issuer?.environment||!issuer?.municipalityIbge)
   fail('Emitente fiscal incompleto');
 const ufInfo=assertFiscalIssuerUf(issuer);
 if(document.environment!==issuer.environment)fail('Ambiente diverge do rascunho');
 const original=plain(document.snapshot_json,1024*1024);
 const hash=createHash('sha256').update(document.snapshot_json).digest('hex');
 if(hash!==document.snapshot_hash)fail('Snapshot canônico alterado');
 const source=JSON.parse(document.snapshot_json);
 if(!Array.isArray(source.lines)||!source.lines.length||source.lines.length>100||
   !Array.isArray(items)||items.length!==source.lines.length||!Array.isArray(profiles))
   fail('Itens da revisão diferem do documento canônico');
 const profileMap=new Map(profiles.map(profile=>{
   const normalized=validateTaxProfile(profile,{issuer});
   if(!normalized.id)fail('Perfil deve estar cadastrado');
   return [normalized.id,normalized];
 }));
 if(profileMap.size!==profiles.length)fail('Identificadores fiscais duplicados');
 const number=match(issuance?.number,/^[1-9]\d{0,8}$/,'Número da nota');
 const series=match(issuance?.series,/^[1-9]\d{0,2}$/,'Série');
 const sections={
   infNFe:{versao:'4.00'},
   Identificacao:{mod:document.kind==='NFCE'?'65':'55',
     cUF:ufInfo.code,cMunFG:issuer.municipalityIbge,serie:series,
     nNF:number,tpAmb:issuer.environment==='HOMOLOGACAO'?'2':'1',
     natOp:plain(issuance?.nature,60),tpNF:'1',finNFe:'1',tpEmis:'1',
     idDest:document.kind==='NFCE'?'1':match(issuance?.idDest??'1',/^[123]$/,'Destino da operação'),
     indFinal:document.kind==='NFCE'?'1':match(issuance?.consumerFinal??'1',/^[01]$/,'Consumidor final'),
     indPres:document.kind==='NFCE'?'1':match(issuance?.presence??'1',/^[01459]$/,'Presença da operação')},
   Emitente:{CNPJCPF:issuer.cnpj,IE:plain(issuer.stateRegistration,30),
     CRT:issuer.taxRegime==='NORMAL'?'3':issuer.taxRegime==='MEI'?'4':'1',
     xNome:plain(company?.legalName,60),...addressFields('emitente',company,{
       uf:issuer.uf,municipalityIbge:issuer.municipalityIbge})}
 };
 const clientDoc=docDigits(source.customer?.document);
 if(clientDoc&&!/^(?:\d{11}|\d{14})$/.test(clientDoc))
   fail('Documento do destinatário inválido');
 if(document.kind==='NFE'&&!clientDoc)fail('NF-e exige destinatário identificado no snapshot');
 if(clientDoc){
   sections.Destinatario={CNPJCPF:clientDoc,
     xNome:plain(customer?.name||source.customer?.name,60),
     indIEDest:match(customer?.taxpayerIndicator??'9',/^[129]$/,'Indicador IE destinatário'),
     ...addressFields('destinatário',customer)};
 }
 let gross=0,discount=0,total=0;
 source.lines.forEach((line,index)=>{
   if(line.kind!=='PECA')fail('NF-e/NFC-e de mercadoria não inclui serviço neste documento');
   const chosen=items[index]||{};
   const profile=profileMap.get(id(chosen.profileId));
   if(!profile||profile.kind!=='GOODS')fail('Selecione perfil de classificação fiscal para cada item');
   const suffix=String(index+1).padStart(3,'0');
   sections['Produto'+suffix]={NCM:profile.ncm,CFOP:profile.cfop,Unidade:profile.unit,
     ...(profile.cest?{CEST:profile.cest}:{}),
     ...(profile.benefitCode?{cBenef:profile.benefitCode}:{})};
   const icms={orig:profile.origin,
     ...(profile.icmsScheme==='CSOSN'?{CSOSN:profile.icmsCode}:{CST:profile.icmsCode})};
   if(profile.icmsScheme==='CST'&&profile.icmsCode==='00'){
     icms.modBC='3';
     Object.assign(icms,components(chosen,'icms','ICMS'));
   }
   sections['ICMS'+suffix]=icms;
   const pis={CST:profile.pisCst},cofins={CST:profile.cofinsCst};
   if(['01','02'].includes(profile.pisCst))
     Object.assign(pis,components(chosen,'pis','PIS'));
   if(['01','02'].includes(profile.cofinsCst))
     Object.assign(cofins,components(chosen,'cofins','COFINS'));
   sections['PIS'+suffix]=pis;
   sections['COFINS'+suffix]=cofins;
   // IBS/CBS recebe somente valores tipados, jamais seções INI livres do navegador.
   if(chosen.ibscbs!=null){
     const input=chosen.ibscbs;
     if(typeof input!=='object'||Array.isArray(input))fail('IBS/CBS exige classificação tipada');
     const taxCst=match(input.cst,/^\d{3}$/,'CST IBS/CBS');
     const taxClass=match(input.cClassTrib,/^\d{6}$/,'cClassTrib');
     const base=taxMoney(input.base),baseCents=Math.round(Number(base)*100);
     const formatted=cents=>(cents/100).toFixed(2);
     const part=(nominalKey,reductionKey,deferralKey,pKey,vKey)=>{
       const pText=percentage(input[nominalKey]),nominal=Number(pText);
       const redText=String(input[reductionKey]??'').trim();
       const defText=String(input[deferralKey]??'').trim();
       if(redText&&defText)fail('IBS/CBS redução e diferimento simultâneos exigem revisão especializada');
       const reduced=redText?percentage(redText):null;
       const deferred=defText?percentage(defText):null;
       const effective=reduced===null?nominal:
         Math.round(nominal*(1-Number(reduced)/100)*10000)/10000;
       const accrued=Math.round(baseCents*effective/100);
       const withheld=deferred===null?0:Math.round(accrued*Number(deferred)/100);
       const values={[pKey]:pText,[vKey]:formatted(accrued-withheld)};
       if(reduced!==null){values.pRedAliq=reduced;values.pAliqEfet=effective.toFixed(4);}
       if(deferred!==null){values.pDif=deferred;values.vDif=formatted(withheld);}
       return values;
     };
     const uf=part('ufRate','reductionUf','deferralUf','pIBSUF','vIBSUF');
     const mun=part('munRate','reductionMun','deferralMun','pIBSMun','vIBSMun');
     const cbs=part('cbsRate','reductionCbs','deferralCbs','pCBS','vCBS');
     sections['IBSCBS'+suffix]={CST:taxCst,cClassTrib:taxClass};
     sections['gIBSCBS'+suffix]={vBC:base,vIBS:formatted(
       Math.round(Number(uf.vIBSUF)*100)+Math.round(Number(mun.vIBSMun)*100))};
     sections['gIBSUF'+suffix]=uf;
     sections['gIBSMun'+suffix]=mun;
     sections['gCBS'+suffix]=cbs;
   }
   gross+=Number(line.subtotalCents);
   discount+=Number(line.discountCents);
   total+=Number(line.totalCents);
 });
 if(!Number.isSafeInteger(total)||total!==Number(document.amount_cents))
   fail('Totais fiscais não conciliam com o rascunho');
 const currency=cents=>(cents/100).toFixed(2);
 sections.Total={vProd:currency(gross),vDesc:currency(discount),vNF:currency(total)};
 if(document.kind==='NFCE'){
   sections.pag001={tPag:match(issuance?.paymentCode,/^\d{2}$/,'Meio de pagamento NFC-e'),
     vPag:currency(total)};
 }
 return {kind:document.kind,documentId:Number(document.id),
   snapshotHash:hash,amountCents:Number(document.amount_cents),
   issuerCnpj:issuer.cnpj,environment:issuer.environment,sections};
}
