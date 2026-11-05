// Fluxo assistido de DPS Nacional a partir do snapshot canônico da OS.
// O SDK MIT gera o XML/XSD e assina com o A1 local; não decide tributos.
import {createHash} from 'node:crypto';
import {buildDpsFromJson} from '@useinvio/nfse-sdk';
import {buildNationalDpsId} from './nfse-national-api.js';

const fail=m=>{throw Error(m)};
const str=(v,regex,label,max=255)=>{
 const s=String(v??'').trim();
 if(!s||s.length>max||!regex.test(s))fail(label+' inválido ou não informado');
 return s;
};
const digits=(v,n,label)=>str(v,new RegExp('^\\d{'+n+'}$'),label,n);
const text=(v,label,max=255)=>str(v,/^[^\x00-\x1f\x7f<>]+$/u,label,max);
const integer=(v,label)=>{
 const n=Number(v);
 if(!Number.isSafeInteger(n)||n<0)fail(label+' inválido');
 return n;
};
const percentage=(v,label)=>{
 const s=str(v,/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/,label,9);
 if(Number(s)>100)fail(label+' acima de 100%');
 return s;
};
export function prepareNationalDpsInput({document,issuer,profile,customer,issuance}={}){
 if(document?.kind!=='NFSE'||document.status!=='RASCUNHO')fail('Apenas rascunho NFS-e permite gerar DPS');
 if(document.environment!=='HOMOLOGACAO')fail('DPS automática somente em homologação até validação do leiaute 2026 IBS/CBS');
 if(createHash('sha256').update(String(document.snapshot_json)).digest('hex')!==document.snapshot_hash)
   fail('Hash do snapshot fiscal divergente');
 let snapshot;
 try{snapshot=JSON.parse(document.snapshot_json)}catch{fail('Snapshot NFS-e inválido')}
 if(snapshot.kind!=='NFSE'||snapshot.nfseRoute?.channel!=='NACIONAL'||
    snapshot.nfseRoute.municipalityIbge!==issuer?.municipalityIbge||
    snapshot.nfseRoute.taxRegime!==issuer?.taxRegime||
    document.environment!==issuer?.environment)fail('Canal, empresa, município ou ambiente fiscal divergente');
 const cnpj=digits(issuer.cnpj,14,'CNPJ da empresa');
 const city=digits(issuer.municipalityIbge,7,'Município IBGE');
 if(profile?.kind!=='SERVICE'||profile.municipalityIbge!==city)
   fail('Perfil de serviço não pertence ao município da empresa');
 const nationalCode=digits(profile.nationalServiceCode,6,'Código nacional do serviço');
 const nbsCode=profile.nbsCode?digits(profile.nbsCode,9,'Código NBS'):undefined;
 if(!Array.isArray(snapshot.lines)||!snapshot.lines.length||snapshot.lines.length>100)
   fail('Serviços da OS não encontrados');
 let total=0,description=[];
 for(const line of snapshot.lines){
   if(!['MAO_DE_OBRA','SERVICO'].includes(line.kind))fail('DPS não pode conter mercadorias');
   const net=integer(line.totalCents,'Valor líquido do serviço');
   const gross=integer(line.subtotalCents,'Valor bruto do serviço');
   const discount=integer(line.discountCents,'Desconto do serviço');
   if(discount!==0)fail('DPS com desconto exige revisão tributária específica');
   if(net!==gross||!net)fail('Linha fiscal com valor divergente');
   total+=net;description.push(text(line.description,'Descrição do serviço',120));
 }
 if(!Number.isSafeInteger(total)||total!==Number(document.amount_cents)||total<=0)
   fail('Valor total do documento diverge dos serviços da OS');
 const person=String(customer?.document??'').replace(/\D/g,'');
 if(![11,14].includes(person.length))fail('CPF/CNPJ do tomador obrigatório');
 const name=text(customer?.name,'Nome do tomador',120);
 const tomador={...(person.length===11?{CPF:person}:{CNPJ:person}),
   xNome:name,end:{endNac:{cMun:digits(customer?.municipalityIbge,7,'Município tomador'),
     CEP:digits(customer?.zip,8,'CEP tomador')},
     xLgr:text(customer?.street,'Logradouro tomador',120),
     nro:text(customer?.number,'Número endereço tomador',20),
     xBairro:text(customer?.district,'Bairro tomador',60)}};
 if(customer?.email)tomador.email=str(customer.email,/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/,'E-mail tomador',120);
 const series=str(issuance?.series,/^[1-9]\d{0,4}$/,'Série da DPS',5);
 const number=str(issuance?.number,/^[1-9]\d{0,14}$/,'Número da DPS',15);
 const issuedAt=str(issuance?.issuedAt,
   /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:-03:00|-02:00|-04:00)$/,
   'Emissão com fuso horário',25);
 const opSimpNac=str(issuance?.opSimpNac,/^[123]$/,'Opção Simples Nacional',1);
 const regEspTrib=str(issuance?.regEspTrib,/^[0-9]$/,'Regime especial',1);
 const tribISSQN=str(issuance?.tribISSQN,/^[1234]$/,'Tributação ISS',1);
 const tpRetISSQN=str(issuance?.tpRetISSQN,/^[123]$/,'Retenção ISS',1);
 if(profile.withheld!==undefined&&Boolean(profile.withheld)!==(tpRetISSQN==='2'))
   fail('Retenção ISS diverge do perfil tributário aprovado');
 const federal=str(issuance?.cstPisCofins,/^\d{2}$/,'CST PIS/COFINS',2);
 const taxRate={
   pTotTribFed:percentage(issuance?.percentFederal,'Carga tributária federal'),
   pTotTribEst:percentage(issuance?.percentState,'Carga tributária estadual'),
   pTotTribMun:percentage(issuance?.percentMunicipal,'Carga tributária municipal')
 };
 const totTrib=opSimpNac==='3'
   ?{pTotTribSN:percentage(issuance?.percentSimples,'Carga tributária do Simples Nacional')}
   :taxRate;
 const payload={ambiente:'restrita',prestador:{
   cnpj,cLocEmi:city,serie:series,opSimpNac,regEspTrib,
   ...(issuance?.regApTribSN?{regApTribSN:str(issuance.regApTribSN,/^[123]$/,'Apuração Simples Nacional',1)}:{})
 },servico:{
   cTribNac:nationalCode,xDescServ:description.join('; ').slice(0,1500),
   cLocPrestacao:city,...(nbsCode?{cNBS:nbsCode}:{})
 },emissao:{
   nDPS:number,dhEmi:issuedAt,dCompet:snapshot.nfseRoute.competenceDate,
   tomador,valores:{vServ:(total/100).toFixed(2)},
   tributacaoMunicipal:{tribISSQN,tpRetISSQN,
     ...(tribISSQN==='3'?{cPaisResult:'BR'}:{}),
     ...(tribISSQN==='2'?{tpImunidade:str(issuance?.tpImunidade,/^[1-9]$/,'Imunidade ISS',1)}:{})},
   tributacaoFederal:{piscofins:{CST:federal}},
   totTrib
 }};
 // O SDK valida estruturalmente os campos do leiaute nacional, sem substituir XSD/homologação.
 const built=buildDpsFromJson(payload);
 const expected=buildNationalDpsId({municipalityIbge:city,cnpj,series,number});
 if(built.id!==expected)fail('Identificador DPS gerado não corresponde ao cadastro fiscal');
 if(Buffer.byteLength(built.xml,'utf8')>512*1024)fail('DPS gerada excede limite');
 return {payload,idDps:built.id,xml:built.xml};
}
