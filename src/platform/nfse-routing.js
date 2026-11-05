// NFS-e: roteamento fiscal por competência, regime e cidade.
// Fonte nacional: CGSN 191/2026 e comunicado NFS-e de 29/10/2026.
// Não tenta inferir provedor por DDD, nem envia notas sem configuração fiscal explícita.
const NATIONAL_SIMPLIFIED_FROM='2026-11-01';
const NATIONAL_MEI_FROM='2023-09-01';
const VALID_REGIMES=new Set(['MEI','SIMPLES','NORMAL']);
const MUNICIPAL_PROVIDER_CONFIRMED=Object.freeze({
  '4128104':Object.freeze({name:'Umuarama',source:'https://umuarama.pr.gov.br/noticias/fazenda/nfs-e-ganha-novo-modelo-umuarama-mantm-sistema-prprio-de-emisso'}),
  '4104303':Object.freeze({name:'Campo Mourão',source:'https://www.campomourao.pr.gov.br/autoatendimento/servicos/acesso-ao-sistema-fiscal'}),
  '4126256':Object.freeze({name:'Sarandi',source:'https://sarandi.oxy.elotech.com.br/iss/home'})
});
const RULES=Object.freeze({
  '4105508':Object.freeze([{from:'2026-01-01',channel:'NACIONAL',regimes:['MEI','SIMPLES','NORMAL'],
   source:'https://cianorte.pr.gov.br/noticiasView/10581_Prestadores-de-servicos-devem-migrar-a-NFS-e-Nacional-ate-31-de-dezembro.html'}]),
  '4115200':Object.freeze([
    {from:'2026-05-01',channel:'NACIONAL',regimes:['SIMPLES'],
     source:'https://nfse.ecity.maringa.pr.gov.br/'},
    {from:'2026-07-01',channel:'NACIONAL',regimes:['MEI','SIMPLES','NORMAL'],
     source:'https://nfse.ecity.maringa.pr.gov.br/'}
  ])
});
const OFFICIAL='https://www.gov.br/nfse/pt-br/noticias/nfs-e-informa-diretrizes-sobre-a-obrigatoriedade-da-emissao-da-nfs-e-nacional-para-optantes-do-simples-nacional/';
export const NFSE_CHANNELS=Object.freeze(['NACIONAL','MUNICIPAL','PENDENTE']);
export function validCompetenceDate(value){
 const date=String(value??'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Informe a data de competência da NFS-e (AAAA-MM-DD)');
 const parsed=new Date(date+'T00:00:00.000Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)
   throw Error('Data de competência inválida');
 return date;
}
export function resolveNfseRoute({municipalityIbge,taxRegime,competenceDate}={}){
 const city=String(municipalityIbge??'').trim(),regime=String(taxRegime??'').trim().toUpperCase();
 const date=validCompetenceDate(competenceDate);
 if(!/^\d{7}$/.test(city)||!['31','33','35','41','42','43'].includes(city.slice(0,2)))
   throw Error('Município IBGE do emitente inválido ou UF não habilitada');
 if(!VALID_REGIMES.has(regime))throw Error('Regime tributário do emitente inválido');
 const fixed=(channel,reason,source)=>Object.freeze({
   channel,automatic:channel!=='PENDENTE',competenceDate:date,
   municipalityIbge:city,taxRegime:regime,reason,source
 });
 if(regime==='MEI'&&date>=NATIONAL_MEI_FROM)
   return fixed('NACIONAL','MEI deve utilizar o Emissor Nacional desde 01/09/2023',
     'https://www.gov.br/nfse/pt-br/mei-prestadores-de-servico-de-todo-o-pais-estao-obrigados-a-emitir-nfs-e');
 if(regime==='SIMPLES'&&date>=NATIONAL_SIMPLIFIED_FROM)
   return fixed('NACIONAL','ME/EPP Simples: Emissor Nacional obrigatório para esta competência',OFFICIAL);
 const cityRules=RULES[city]||[];
 const matching=cityRules.filter(rule=>rule.regimes.includes(regime)&&date>=rule.from)
   .sort((a,b)=>b.from.localeCompare(a.from))[0];
 if(matching)return fixed(matching.channel,'Cronograma municipal confirmado para esta competência',matching.source);
 const municipal=MUNICIPAL_PROVIDER_CONFIRMED[city];
 if(municipal&&date>='2026-01-01'&&regime!=='MEI')
   return fixed('MUNICIPAL','Prefeitura mantém emissor municipal para este regime e competência; confirmar autorização do contribuinte',municipal.source);
 return fixed('PENDENTE','Regra municipal não confirmada para o regime e a competência; revisar o provedor antes de emitir',OFFICIAL);
}
export function assertNfseRouteForTransmission(document,issuer,provider){
 if(document?.kind!=='NFSE')return null;
 let snapshot;
 try{snapshot=JSON.parse(document.snapshot_json);}catch{throw Error('Snapshot NFS-e sem rota fiscal válida');}
 const saved=snapshot?.nfseRoute;
 if(!saved||typeof saved!=='object'||!saved.competenceDate||!saved.channel)
   throw Error('Snapshot NFS-e legado sem competência ou canal: regularizar antes de emitir');
 const effective=resolveNfseRoute({municipalityIbge:issuer?.municipalityIbge,
   taxRegime:issuer?.taxRegime,competenceDate:saved.competenceDate});
 if(effective.channel==='PENDENTE')throw Error('Regra municipal NFS-e pendente: não é seguro transmitir');
 if(saved.channel!==effective.channel||saved.municipalityIbge!==effective.municipalityIbge||
   saved.taxRegime!==effective.taxRegime||saved.competenceDate!==effective.competenceDate)
   throw Error('Cadastro fiscal mudou: competência, município ou regime não correspondem ao rascunho NFS-e');
 if(provider?.nfseChannel!==effective.channel)
   throw Error('Emissor NFS-e não configurado para o canal '+effective.channel+'; selecionar adaptador fiscal compatível');
 if(effective.channel==='MUNICIPAL'&&provider.nfseMunicipalityIbge!==effective.municipalityIbge)
   throw Error('Emissor municipal NFS-e não configurado para o município IBGE do emitente');
 return effective;
}
