// Evidência fiscal canônica por unidade. Não há autorização gerada por checkbox,
// ping da SEFAZ ou teste simulado. A prova só nasce do retorno do ACBr local.
import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const clean=value=>String(value??'').trim();
const digits=value=>clean(value).replace(/\D/g,'');
const validDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const supportedModels=['NFE','NFCE'];

export function issuerEvidenceDigest(settings={}){
  const identity={
    cnpj:digits(settings.issuer_cnpj??settings.cnpj),
    uf:clean(settings.issuer_uf??settings.uf).toUpperCase(),
    municipalityIbge:digits(settings.municipality_ibge??settings.municipalityIbge),
    taxRegime:clean(settings.tax_regime??settings.taxRegime).toUpperCase(),
    stateRegistration:clean(settings.state_registration??settings.stateRegistration),
    municipalRegistration:clean(settings.municipal_registration??settings.municipalRegistration)
  };
  return digest(JSON.stringify(identity));
}

function officialNfeXml({xml,accessKey,protocol,cnpj,kind}){
  const text=clean(xml);
  // Os workers ACBr também conferem modelo, protocolo, emitente e ambiente.
  // Esta checagem é uma defesa adicional para não persistir prova de XML parcial.
  if(text.length<120||text.length>9*1024*1024||
     !/<(?:[A-Za-z_][\w.-]*:)?nfeProc[\s>]/.test(text)||
     !/<(?:[A-Za-z_][\w.-]*:)?cStat>100<\//.test(text)||
     !/<(?:[A-Za-z_][\w.-]*:)?tpAmb>2<\//.test(text)||
     !/^[0-9]{44}$/.test(accessKey)||!/^\d{5,20}$/.test(protocol)||
     accessKey.slice(6,20)!==cnpj||
     !['55','65'].includes(accessKey.slice(20,22))||
     (kind&&accessKey.slice(20,22)!==(kind==='NFCE'?'65':'55'))||
     !text.includes(accessKey)||!text.includes(protocol)||
     !new RegExp('<(?:[A-Za-z_][\\w.-]*:)?CNPJ>'+cnpj+'<\\/').test(text))return false;
  return true;
}

// Esta função é usada SOMENTE depois de retorno AUTORIZADA do emissor ACBr,
// validado no worker. Não aceita prova fornecida por uma rota HTTP do cliente.
export function createFiscalEvidence({document,result,providerName,certificateIdentity}={}){
  if(providerName!=='acbrlib-local'||!validDigest(certificateIdentity)||
     !supportedModels.includes(document?.kind)||
     document?.environment!=='HOMOLOGACAO'||
     result?.status!=='AUTORIZADA'||result.environment!=='HOMOLOGACAO')
    return null;
  let issuer;
  try{issuer=JSON.parse(document.issuer_snapshot_json||'null');}
  catch{return null;}
  const issuerCnpj=digits(issuer?.cnpj);
  if(!/^\d{14}$/.test(issuerCnpj)||issuer?.environment!=='HOMOLOGACAO'||
     !officialNfeXml({xml:result.xml,accessKey:result.accessKey,
       protocol:result.protocol,cnpj:issuerCnpj,kind:document.kind}))return null;
  return {
    document_id:Number(document.id),kind:document.kind,
    issuer_digest:issuerEvidenceDigest(issuer),
    certificate_digest:certificateIdentity,
    xml_digest:digest(result.xml),
    provider_name:providerName
  };
}

export function buildFiscalReleaseStatus({
  settings={},certificate={configured:false},certificateIdentity=null,
  providerName='',providerReady=false,proofs=[]
}={}){
  const companyConfigured=Boolean(settings.enabled);
  const certificateReady=certificate?.configured===true&&validDigest(certificateIdentity);
  const localProvider=providerName==='acbrlib-local'&&providerReady;
  const issuerDigest=issuerEvidenceDigest(settings);
  const models={};
  for(const kind of [...supportedModels,'NFSE']){
    const proof=kind==='NFSE'?null:(Array.isArray(proofs)?proofs:[]).find(row=>
      row.kind===kind&&row.provider_name==='acbrlib-local'&&
      row.status==='AUTORIZADA_HOMOLOGACAO'&&row.environment==='HOMOLOGACAO'&&
      row.issuer_digest===issuerDigest&&
      row.certificate_digest===certificateIdentity&&
      validDigest(row.xml_digest)&&digest(clean(row.authorized_xml))===row.xml_digest&&
      officialNfeXml({xml:row.authorized_xml,
        accessKey:row.access_key,protocol:row.protocol,cnpj:digits(settings.issuer_cnpj),kind})
    );
    const homologationVerified=Boolean(proof);
    const external=kind==='NFSE'
      ?'NFS-e exige prova específica do emissor nacional/municipal'
      :kind==='NFCE'&&settings.issuer_uf==='SC'
        ?'PAF-NFC-e de SC exige credenciamento e validação específica'
      :kind==='NFCE'&&settings.issuer_uf==='RS'
        ?'NFC-e no RS exige integração comprovada de pagamento eletrônico'
      :null;
    const productionReady=companyConfigured&&certificateReady&&localProvider&&
      homologationVerified&&!external&&settings.environment==='PRODUCAO'&&
      Boolean(settings.production_confirmed);
    const reason=external||
      (!companyConfigured?'Cadastro fiscal incompleto':
      !certificateReady?'Certificado local ainda não validado':
      !localProvider?'ACBr local indisponível':
      !homologationVerified?'Falta autorização real em homologação para '+kind:
      settings.environment!=='PRODUCAO'?'Ambiente de homologação':
      !settings.production_confirmed?'Confirmação administrativa pendente':'Liberado para este modelo');
    models[kind]={
      homologationVerified,taxProfileVerified:homologationVerified,
      productionReady,reason,
      evidenceDocumentId:proof?.document_id??null
    };
  }
  return {
    companyConfigured,
    authorizationVerified:supportedModels.some(k=>models[k].homologationVerified),
    taxProfileVerified:supportedModels.some(k=>models[k].taxProfileVerified),
    productionReady:supportedModels.some(k=>models[k].productionReady),
    models
  };
}
