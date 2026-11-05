// Revisão NFS-e ACBr por município; sem inventar código de serviço, ISS ou provedor.
// A configuração municipal/credenciamento real continua uma exigência externa.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const fail=message=>{throw new Error(message);};
const digits=v=>String(v??'').replace(/\D/g,'');
const str=v=>String(v??'').trim();
const money=(v,label)=>{
 const s=str(v);
 if(!/^(?:0|[1-9]\d{0,10})\.\d{2}$/.test(s))fail(label+' inválido: informar R$ com duas casas');
 return Number(s.replace('.',''));
};
const rate=(v,label)=>{
 const s=str(v);
 if(!/^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/.test(s)||Number(s)>100)
  fail(label+' inválida');
 return Number(s);
};
const required=(value,label,regex)=>{
 const s=str(value);
 if(!regex.test(s))fail(label+' obrigatório ou inválido');
 return s;
};
const amount=cents=>(cents/100).toFixed(2);
function linesToIni(sections){
 const allowed=['IdentificacaoRps','Prestador','Tomador','Servico','Valores'];
 const safe=/^[A-Za-z][A-Za-z0-9_]{0,55}$/;
 let result='';
 for(const name of allowed){
  const fields=sections[name];
  if(!fields)continue;
  result+='['+name+']\n';
  for(const [key,value] of Object.entries(fields)){
   if(!safe.test(key)||!['string','number'].includes(typeof value)||str(value).length>1024||
      /[\x00-\x1f\x7f]/.test(String(value)))fail('Valor fiscal INI inválido ou contém quebra de linha');
   result+=key+'='+String(value)+'\n';
  }
  result+='\n';
 }
 if(Buffer.byteLength(result)>1024*1024)fail('INI NFS-e acima de 1MB');
 return result;
}
export function compileReviewedNfseIni({document,issuer,review}={}){
 if(document?.kind!=='NFSE'||!issuer||!review)fail('Revisão NFS-e obrigatória');
 const original=str(document.snapshot_json),hash=createHash('sha256').update(original).digest('hex');
 if(document.snapshot_hash!==hash)fail('Snapshot NFS-e foi alterado');
 const manifest={kind:'NFSE',documentId:Number(document.id),snapshotHash:hash,
  amountCents:Number(document.amount_cents),issuerCnpj:String(issuer.cnpj),
  environment:String(issuer.environment)};
 for(const [k,v] of Object.entries(manifest))
  if(review[k]!==v)fail('Manifesto NFS-e diverge do documento: '+k);
 if(review.reviewerConfirmed!==true)fail('Confirmação de revisão do contador/emitente obrigatória');
 if(review.provider!=='ACBR_NFSE')fail('Provedor NFS-e ACBr não validado');
 const municipality=required(review.municipalityIbge,'Município IBGE',/^\d{7}$/);
 if(municipality!==String(issuer.municipalityIbge))fail('Município do provedor NFS-e não corresponde ao emitente');
 const sections=structuredClone(review.sections);
 if(!sections||typeof sections!=='object'||Array.isArray(sections)||
    ['IdentificacaoRps','Prestador','Servico','Valores'].some(k=>!sections[k]||typeof sections[k]!=='object'))
  fail('Seções obrigatórias NFS-e incompletas');
 if(Object.keys(sections).some(name=>!['IdentificacaoRps','Prestador','Tomador','Servico','Valores'].includes(name)))
  fail('Seção NFS-e não reconhecida');
 const rps=sections.IdentificacaoRps,prest=sections.Prestador,serv=sections.Servico,values=sections.Valores;
 required(rps.Numero,'Número RPS',/^[1-9]\d{0,14}$/);
 required(rps.Serie,'Série RPS',/^[A-Za-z0-9]{1,5}$/);
 required(rps.Tipo,'Tipo RPS',/^[1-3]$/);
 for(const field of ['DataEmissao','Competencia'])
  required(rps[field],field+' RPS',/^\d{2}\/\d{2}\/\d{4}$/);
 if(digits(prest.CNPJ)!==String(issuer.cnpj)||!str(prest.InscricaoMunicipal))
  fail('Prestador NFS-e diverge do CNPJ/inscrição municipal');
 if(String(prest.CodigoMunicipio)!==municipality||String(serv.CodigoMunicipio)!==municipality||
    String(serv.MunicipioIncidencia)!==municipality)
  fail('Município IBGE da NFS-e divergente; operações intermunicipais exigem revisão específica');
 required(serv.ItemListaServico,'Código da lista de serviço',/^\d{1,2}\.\d{2}$/);
 required(serv.CodigoTributacaoMunicipio,'Código de tributação do serviço municipal',/^[A-Za-z0-9.-]{1,20}$/);
 required(serv.Discriminacao,'Descrição do serviço',/^[\s\S]{3,1024}$/);
 if(sections.Tomador){
  const customer=JSON.parse(original).customer||{};
  const doc=digits(customer.document);
  if(doc&&doc!==digits(sections.Tomador.CNPJCPF))
    fail('Documento do tomador diverge da OS/venda');
 }
 let snapshot;
 try{snapshot=JSON.parse(original);}catch{fail('Snapshot NFS-e inválido');}
 if(!Array.isArray(snapshot.lines)||!snapshot.lines.length||snapshot.lines.length>100)
  fail('Serviços NFS-e não encontrados no snapshot');
 const total=snapshot.lines.reduce((acc,line)=>{
  const sub=Number(line.subtotalCents),discount=Number(line.discountCents),net=Number(line.totalCents);
  if(!Number.isSafeInteger(sub)||!Number.isSafeInteger(discount)||!Number.isSafeInteger(net)||
    sub<0||discount<0||net!==sub-discount)fail('Valores da OS inconsistentes');
  return {gross:acc.gross+sub,net:acc.net+net};
 },{gross:0,net:0});
 if(total.net!==Number(document.amount_cents)||
    money(values.ValorServicos,'ValorServicos')!==total.gross||
    money(values.ValorLiquidoNfse,'ValorLiquidoNfse')!==total.net)
  fail('Valores NFS-e divergem dos lançamentos canônicos');
 const base=money(values.BaseCalculo,'Base ISS');
 if(base>total.net)fail('Base ISS maior que serviço líquido');
 const aliquota=rate(values.Aliquota,'Alíquota ISS');
 const iss=money(values.ValorIss,'Valor ISS');
 if(Math.abs(Math.round(base*aliquota/100)-iss)>1)
  fail('ISS informado diverge da base/alíquota revisadas');
 if(!['1','2'].includes(str(values.ISSRetido)))fail('ISSRetido deve ser indicado explicitamente');
 if(str(values.ISSRetido)==='1'&&money(values.ValorIssRetido,'ValorIssRetido')!==iss)
  fail('ISS retido difere do ISS calculado');
 if(str(values.ISSRetido)==='2'&&values.ValorIssRetido!==undefined&&
    money(values.ValorIssRetido,'ValorIssRetido')!==0)
  fail('ISS não retido não admite valor de retenção');
 // Campos de valores calculados nunca podem ser preenchidos por tentativa posterior.
 const ini=linesToIni(sections);
 return {ini,manifest};
}
export function prepareReviewedNfseIni({inputDir,document,issuer}={}){
 if(document?.kind!=='NFSE')return false;
 const stem='NFSE-'+document.id+'-'+document.snapshot_hash;
 const iniPath=join(inputDir,stem+'.ini'),manifestPath=join(inputDir,stem+'.json');
 if(existsSync(iniPath)||existsSync(manifestPath))return false;
 const reviewPath=join(inputDir,stem+'.review.json');
 if(!existsSync(reviewPath))return false;
 if(statSync(reviewPath).size>1024*1024)fail('Revisão municipal excede limite');
 let review;
 try{review=JSON.parse(readFileSync(reviewPath,'utf8'));}catch{fail('Revisão NFS-e JSON inválida');}
 const out=compileReviewedNfseIni({document,issuer,review});
 writeFileSync(iniPath,out.ini,{flag:'wx',mode:0o600});
 writeFileSync(manifestPath,JSON.stringify(out.manifest),{flag:'wx',mode:0o600});
 return true;
}
