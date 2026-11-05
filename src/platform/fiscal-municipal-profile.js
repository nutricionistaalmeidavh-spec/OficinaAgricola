// Perfil municipal revisado e privado por empresa. Não contém certificados,
// endpoints, senhas nem substitui homologação oficial com a prefeitura.
import {readFileSync,statSync} from 'node:fs';
const fail=m=>{throw new Error(m);};
const digits=x=>String(x??'').replace(/\D/g,'');
export function assertMunicipalNfseProductionReady({
 path,issuer,serviceCode,now=new Date().toISOString().slice(0,10)
}={}){
 if(!path||typeof path!=='string')fail('Configuração fiscal municipal ausente; emissão NFS-e em produção bloqueada');
 let manifest;
 try{
  if(statSync(path).size>131072)fail('Configuração municipal muito grande');
  manifest=JSON.parse(readFileSync(path,'utf8'));
 }catch{fail('Configuração fiscal municipal indisponível/ilegível');}
 if(manifest?.schemaVersion!==1||!manifest.municipalities||
     typeof manifest.municipalities!=='object')
   fail('Configuração fiscal municipal inválida');
 const mun=String(issuer?.municipalityIbge||'');
 if(!/^\d{7}$/.test(mun)||!/^\d{14}$/.test(digits(issuer?.cnpj)))
   fail('CNPJ ou município do emitente inválido');
 const entry=manifest.municipalities[mun];
 if(!entry)fail('Município não parametrizado/homologado para NFS-e');
 if(digits(entry.issuerCnpj)!==digits(issuer.cnpj))
   fail('CNPJ do perfil municipal diverge do emitente');
 if(entry.provider!=='ACBR_NFSE')fail('Provedor municipal não habilitado no ACBr local');
 if(!Array.isArray(entry.serviceCodes)||!entry.serviceCodes.includes(serviceCode))
   fail('Código de serviço não homologado/parametrizado neste município');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt||'')||
    !/^\d{4}-\d{2}-\d{2}$/.test(now))
   fail('Data de revisão municipal inválida');
 const diff=(Date.parse(now+'T00:00:00Z')-Date.parse(entry.reviewedAt+'T00:00:00Z'))/86400000;
 if(!Number.isFinite(diff)||diff<0||diff>60)
   fail('Perfil municipal desatualizado: renovar confirmação das regras locais');
 if(!/^[A-Za-z0-9._/: -]{12,160}$/.test(String(entry.homologationEvidence||''))||
    !/^[A-Za-z0-9._ -]{4,100}$/.test(String(entry.authorizedBy||'')))
   fail('Evidência de homologação municipal e responsável fiscal obrigatórios');
 // Referência declarada pela oficina, sem alegar verificação pelo governo.
 return Object.freeze({...entry,municipalityIbge:mun,verifiedOnline:false});
}
