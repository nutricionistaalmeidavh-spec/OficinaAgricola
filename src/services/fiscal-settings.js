import {transaction,nowIso} from '../db.js';

const STATES=new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const REGIMES=new Set(['MEI','SIMPLES','NORMAL']);
const digits=value=>String(value??'').replace(/\D/g,'');
function validCnpj(value){
  const cnpj=digits(value);
  if(cnpj.length!==14||/^(\d)\1+$/.test(cnpj))return false;
  for(const size of [12,13]){
    const weights=size===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum=weights.reduce((s,w,i)=>s+w*Number(cnpj[i]),0);
    const remainder=sum%11;
    if(Number(cnpj[size])!==(remainder<2?0:11-remainder))return false;
  }
  return true;
}
export function getFiscalSettings(db){
  return db.prepare('SELECT * FROM fiscal_settings WHERE id=1').get();
}
export function setFiscalSettings(db,input={}){
  return transaction(db,()=>{
    const old=getFiscalSettings(db);
    const issuerCnpj=input.issuerCnpj===undefined?old.issuer_cnpj:digits(input.issuerCnpj);
    const issuerUf=input.issuerUf===undefined?old.issuer_uf:String(input.issuerUf).trim().toUpperCase();
    const municipalityIbge=input.municipalityIbge===undefined?old.municipality_ibge:digits(input.municipalityIbge);
    const taxRegime=input.taxRegime===undefined?old.tax_regime:String(input.taxRegime).trim().toUpperCase();
    const stateRegistration=input.stateRegistration===undefined?old.state_registration:String(input.stateRegistration).trim().slice(0,40);
    const municipalRegistration=input.municipalRegistration===undefined?old.municipal_registration:String(input.municipalRegistration).trim().slice(0,40);
    const environment=input.environment===undefined?old.environment:String(input.environment).trim().toUpperCase();
    const enabled=input.enabled===undefined?Boolean(old.enabled):input.enabled===true;
    const productionConfirmed=input.productionConfirmed===undefined?Boolean(old.production_confirmed):input.productionConfirmed===true;
    if(issuerCnpj&&!validCnpj(issuerCnpj))throw new Error('CNPJ do emissor inválido');
    if(issuerUf&&!STATES.has(issuerUf))throw new Error('UF do emissor inválida');
    if(municipalityIbge&&!/^\d{7}$/.test(municipalityIbge))throw new Error('Município IBGE inválido');
    if(taxRegime&&!REGIMES.has(taxRegime))throw new Error('Regime tributário inválido');
    if(!['HOMOLOGACAO','PRODUCAO'].includes(environment))throw new Error('Ambiente fiscal inválido');
    if(enabled&&(!validCnpj(issuerCnpj)||!STATES.has(issuerUf)||!/^\d{7}$/.test(municipalityIbge)||!REGIMES.has(taxRegime)))
      throw new Error('Complete CNPJ, UF, município IBGE e regime tributário antes de habilitar o fiscal');
    if(enabled&&environment==='PRODUCAO'&&!productionConfirmed)
      throw new Error('Produção exige confirmação administrativa explícita');
    db.prepare('UPDATE fiscal_settings SET enabled=?,environment=?,issuer_cnpj=?,issuer_uf=?,municipality_ibge=?,tax_regime=?,state_registration=?,municipal_registration=?,production_confirmed=?,updated_at=? WHERE id=1')
      .run(enabled?1:0,environment,issuerCnpj,issuerUf,municipalityIbge,taxRegime,stateRegistration,municipalRegistration,productionConfirmed?1:0,nowIso());
    return getFiscalSettings(db);
  });
}
export function assertFiscalReady(db,document){
  const settings=getFiscalSettings(db);
  if(!settings.enabled)throw new Error('Fiscal desabilitado: configure a empresa antes de transmitir');
  if(document.environment!==settings.environment)throw new Error('Rascunho fiscal de outro ambiente; revise antes de transmitir');
  if(settings.environment==='PRODUCAO'&&!settings.production_confirmed)
    throw new Error('Produção fiscal não confirmada');
  if(!validCnpj(settings.issuer_cnpj)||!STATES.has(settings.issuer_uf)||!/^\d{7}$/.test(settings.municipality_ibge))
    throw new Error('Configuração fiscal incompleta');
  return settings;
}
