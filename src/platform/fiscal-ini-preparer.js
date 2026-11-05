// Emissão determinística a partir de revisão tributária explícita.
// Nunca presume NCM, CFOP, CSOSN/CST, base de cálculo, alíquotas ou série.
// Certificados e senhas pertencem exclusivamente à configuração ACBr local.
import {createHash,randomInt} from 'node:crypto';
import {readFileSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {assertReviewedFiscalUf} from './fiscal-uf.js';
import {validateReviewedTaxItems} from './fiscal-tax-assist.js';
import {loadConfiguredFiscalCatalog} from './fiscal-official-catalog.js';

const fail=message=>{throw new Error(message)};
const money=value=>{
 const text=String(value??'').trim();
 if(!/^(?:0|[1-9]\d*)\.\d{2}$/.test(text))fail('Valor tributário não usa centavos exatos');
 const [whole,decimal]=text.split('.');
 const cents=Number(whole)*100+Number(decimal);
 if(!Number.isSafeInteger(cents))fail('Valor tributário acima do limite seguro');
 return cents;
};
const cents=value=>{
 if(!Number.isSafeInteger(Number(value))||Number(value)<0)fail('Valor canônico inválido');
 return (Number(value)/100).toFixed(2);
};
const block=(key,value)=>{
 if(!/^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(key))
   fail('Identificador de campo fiscal INI inválido');
 if(!['string','number','boolean'].includes(typeof value)||
     String(value).length>1024||/[\x00-\x1f\x7f]/.test(String(value)))
   fail('Valor fiscal INI inválido ou contém outra linha');
 return key+'='+String(value);
};
export function compileReviewedFiscalIni({document,issuer,review,catalog=loadConfiguredFiscalCatalog()}={}){
 if(!document||!['NFE','NFCE'].includes(document.kind)||!issuer||!review)
   fail('Nota fiscal, emitente e revisão tributária obrigatórios');
 const original=String(document.snapshot_json||'');
 const hash=createHash('sha256').update(original).digest('hex');
 if(document.snapshot_hash!==hash)fail('Snapshot fiscal canônico alterado');
 let snapshot;
 try{snapshot=JSON.parse(original)}catch{fail('Snapshot fiscal não é JSON válido')}
 const required={kind:document.kind,documentId:Number(document.id),
   snapshotHash:hash,amountCents:Number(document.amount_cents),
   issuerCnpj:String(issuer.cnpj),environment:String(issuer.environment)};
 for(const [key,value] of Object.entries(required)){
   if(review[key]!==value)fail('Manifesto fiscal não corresponde ao valor/emitente/snapshot: '+key);
 }
 if(!Array.isArray(snapshot.lines)||snapshot.lines.length<1||snapshot.lines.length>100)
   fail('Itens fiscais fora do limite de geração');
 const sections=structuredClone(review.sections);
 if(!sections||typeof sections!=='object'||Array.isArray(sections))
   fail('Seções fiscais revisadas inválidas');
 const necessary=document.kind==='NFCE'
   ?['infNFe','Identificacao','Emitente','Total']
   :['infNFe','Identificacao','Emitente','Destinatario','Total'];
 if(necessary.some(k=>!sections[k]||typeof sections[k]!=='object'||Array.isArray(sections[k])))
   fail('INI revisado sem seções estruturais obrigatórias');
 // cUF e cMunFG não são inferidos: a revisão tributária deve coincidir
 // exatamente com o município e a UF da empresa.
 assertReviewedFiscalUf({kind:document.kind,issuer,sections});
 const ide=sections.Identificacao;
 if(!/^[1-9][0-9]{0,8}$/.test(String(ide.nNF||''))||
    !/^(?:0|[1-9][0-9]{0,2})$/.test(String(ide.serie||'')))
   fail('Número ou série da NF-e inválidos');
 // cNF identifica a nota; não deve ser calculado a partir do número fiscal.
 if(!ide.cNF)ide.cNF=String(randomInt(0,100000000)).padStart(8,'0');
 if(!/^\d{8}$/.test(String(ide.cNF)))fail('Código aleatório cNF inválido');
 if(!ide.dhEmi){
   const values=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
     timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
     hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
   }).formatToParts(new Date()).map(x=>[x.type,x.value]));
   ide.dhEmi=values.day+'/'+values.month+'/'+values.year+' '+
     values.hour+':'+values.minute+':'+values.second;
 }

 if(String(sections.Emitente.CNPJCPF||'').replace(/\D/g,'')!==issuer.cnpj)
   fail('CNPJ revisado diverge do emitente');
 const customer=String(snapshot.customer?.document||'').replace(/\D/g,'');
 if(customer&&(document.kind==='NFE'||sections.Destinatario)&&
    customer!==String(sections.Destinatario?.CNPJCPF||'').replace(/\D/g,''))
   fail('Destinatário diverge do snapshot');
 // Verificação do enquadramento informado antes de gerar XML/INI.
 validateReviewedTaxItems({issuer,sections,lines:snapshot.lines,catalog});
 let gross=0,discount=0,net=0;
 snapshot.lines.forEach((line,index)=>{
   const suffix=String(index+1).padStart(3,'0');
   const item=sections['Produto'+suffix];
   if(!item||!sections['ICMS'+suffix]||!sections['PIS'+suffix]||!sections['COFINS'+suffix])
     fail('Tributação NCM/CFOP/ICMS/PIS/COFINS obrigatória por item '+suffix);
   if(!/^\d{8}$/.test(String(item.NCM||''))||!/^\d{4}$/.test(String(item.CFOP||'')))
     fail('NCM e CFOP precisam de classificação tributária revisada');
   if(!Number.isFinite(Number(line.quantity))||Number(line.quantity)<=0||
       !Number.isSafeInteger(Number(line.subtotalCents))||
       !Number.isSafeInteger(Number(line.discountCents))||
       !Number.isSafeInteger(Number(line.totalCents))||
       Number(line.totalCents)!==Number(line.subtotalCents)-Number(line.discountCents))
     fail('Valores comerciais do item inconsistentes');
   const q=Number(line.quantity);
   if(Math.abs(q*Number(line.unitPriceCents)-Number(line.subtotalCents))>0.51)
     fail('Preço e quantidade não conciliam com a origem');
   const name=String(line.description||'').trim();
   if(!name||name.length>120)fail('Descrição canônica do item inválida');
   // ACBrLib NFe usa as tags do modelo INI oficial: cProd/xProd/qCom/vUnCom/vProd.
   // Os valores comerciais vêm exclusivamente do snapshot imutável, nunca do formulário.
   delete item.Codigo;delete item.Descricao;delete item.Quantidade;
   delete item.ValorUnitario;delete item.ValorTotal;delete item.ValorDesconto;
   item.cProd=String(line.sourceItemId);
   item.xProd=name;
   item.uCom=String(item.uCom||item.Unidade||'UN');
   item.qCom=String(q);
   item.vUnCom=cents(line.unitPriceCents);
   item.vProd=cents(line.subtotalCents);
   item.vDesc=cents(line.discountCents);
   item.uTrib=String(item.uTrib||item.uCom);
   item.qTrib=String(q);
   item.vUnTrib=cents(line.unitPriceCents);
   item.cEAN=String(item.cEAN||'SEM GTIN');
   item.cEANTrib=String(item.cEANTrib||item.cEAN);
   item.indTot='1';
   delete item.Unidade;
   gross+=Number(line.subtotalCents);
   discount+=Number(line.discountCents);
   net+=Number(line.totalCents);
 });
 if(net!==Number(document.amount_cents)||
     money(sections.Total.vProd??sections.Total.ValorProduto)!==gross||
     money(sections.Total.vDesc??sections.Total.ValorDesconto)!==discount||
     money(sections.Total.vNF??sections.Total.ValorNota)!==net)
   fail('Totais tributários divergem dos lançamentos canônicos');
 // Convertemos também totais legados antes de gerar o INI oficial do ACBr.
 delete sections.Total.ValorProduto;
 delete sections.Total.ValorDesconto;
 delete sections.Total.ValorNota;
 sections.Total.vProd=cents(gross);
 sections.Total.vDesc=cents(discount);
 sections.Total.vNF=cents(net);
 for(const [section,fields] of Object.entries(sections)){
   if(!/^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(section)||
       !fields||typeof fields!=='object'||Array.isArray(fields))
     fail('Seção fiscal INI inválida');
 }
 const ordered=[
   ...necessary.filter(k=>k!=='Total'),
   ...Object.keys(sections).filter(k=>!necessary.includes(k)&&k!=='Total'),
   'Total'
 ];
 const ini=ordered.map(name=>'['+name+']\n'+Object.entries(sections[name])
   .map(([key,value])=>block(key,value)).join('\n')).join('\n\n')+'\n';
 if(Buffer.byteLength(ini,'utf8')>1024*1024)fail('INI fiscal acima de 1 MB');
 return {ini,manifest:required};
}
export function prepareReviewedFiscalIni({inputDir,document,issuer}={}){
 if(!['NFE','NFCE'].includes(document?.kind))return false; // NFS-e exige revisão municipal do INI.
 const stem=document.kind+'-'+document.id+'-'+document.snapshot_hash;
 const iniFile=join(inputDir,stem+'.ini');
 const manifestFile=join(inputDir,stem+'.json');
 if(existsSync(iniFile)||existsSync(manifestFile))return false;
 const reviewFile=join(inputDir,stem+'.review.json');
 if(!existsSync(reviewFile))return false;
 if(statSync(reviewFile).size>1024*1024)fail('Revisão fiscal excede limite seguro');
 let review;
 try{review=JSON.parse(readFileSync(reviewFile,'utf8'))}
 catch{fail('Revisão tributária JSON inválida')}
 const result=compileReviewedFiscalIni({document,issuer,review});
 // Nunca sobrescrever material já preparado; manifesto somente após INI íntegro.
 writeFileSync(iniFile,result.ini,{flag:'wx',mode:0o600});
 writeFileSync(manifestFile,JSON.stringify(result.manifest),{flag:'wx',mode:0o600});
 return true;
}
