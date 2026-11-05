// DANFSe v2.0 local: layout da NT 008/2026 v1.02, uma folha A4.
// Core 100% local: XML autorizado, PDF vetorial e QR MIT, sem consulta à API DANFSe suspensa.
import {DOMParser} from '@xmldom/xmldom';
import qrcode from 'qrcode-generator';

const WIDTH=595.28,HEIGHT=841.89;
const KEY=/^\d{50}$/;
const error=message=>{throw Error(message);};
const local=node=>node?.localName||String(node?.nodeName||'').split(':').at(-1);
function child(node,name){
 if(!node)return null;
 for(let el=node.firstChild;el;el=el.nextSibling)
   if(el.nodeType===1&&local(el)===name)return el;
 return null;
}
function chain(node,...names){return names.reduce((el,name)=>child(el,name),node);}
function field(node,name){return (child(node,name)?.textContent||'').trim();}
function first(...values){return values.find(x=>String(x||'').trim())||'';}
const digits=s=>String(s||'').replace(/\D/g,'');
function docNumber(node){return first(field(node,'CNPJ'),field(node,'CPF'),field(node,'NIF'));}
function maskDocument(s){
 if(/^\d{14}$/.test(s))return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
 if(/^\d{11}$/.test(s))return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
 return s;
}
function time(s){
 const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
 return m?m[3]+'/'+m[2]+'/'+m[1]+(m[4]?' '+m[4]+':'+m[5]+':'+m[6]:''):s||'';
}
function money(s){
 if(!s)return '';
 const n=Number(s);
 return Number.isFinite(n)?'R$ '+n.toFixed(2).replace('.',','):String(s);
}
function address(p){
 const a=child(p,'end'),n=child(a,'endNac');
 return {city:first(field(a,'xCidade'),field(n,'cMun')),
  cityCode:field(n,'cMun'),cep:field(n,'CEP'),
  line:[field(a,'xLgr'),field(a,'nro'),field(a,'xCpl'),field(a,'xBairro')].filter(Boolean).join(', ')};
}
function party(p){
 const a=address(p);
 return {id:maskDocument(docNumber(p)),name:field(p,'xNome'),
  registration:field(p,'IM'),phone:field(p,'fone'),email:field(p,'email'),
  city:a.city,cityCode:a.cityCode,cep:a.cep,street:a.line,
  tax:chain(p,'regTrib')};
}
function readXml(xml,accessKey,environment){
 if(!KEY.test(String(accessKey||'')))error('DANFSe exige chave de acesso oficial de 50 dígitos');
 if(!['HOMOLOGACAO','PRODUCAO'].includes(environment))error('Ambiente DANFSe inválido');
 if(typeof xml!=='string'||Buffer.byteLength(xml,'utf8')>1024*1024||
    /<!DOCTYPE|<!ENTITY/i.test(xml))error('XML oficial inseguro ou excede limite');
 let dom;
 try{dom=new DOMParser({errorHandler:{warning:()=>{},error:msg=>error('XML inválido: '+msg),
   fatalError:msg=>error('XML inválido: '+msg)}}).parseFromString(xml,'application/xml');}
 catch{error('XML NFS-e malformado');}
 const root=dom?.documentElement;
 if(local(root)!=='NFSe')error('Documento não é XML oficial NFSe');
 const info=child(root,'infNFSe'),dps=child(info,'DPS'),dpsInfo=child(dps,'infDPS');
 if(!info||!dpsInfo||info.getAttribute('Id')!=='NFS'+accessKey)
   error('Chave DANFSe divergente do XML oficial de NFS-e');
 const tpAmb=field(dpsInfo,'tpAmb');
 if(tpAmb!==(environment==='HOMOLOGACAO'?'2':'1'))
   error('Ambiente do XML divergente do DANFSe solicitado');
 const issuer=party(child(dpsInfo,'prest'));
 if(!/^\d{14}$/.test(digits(issuer.id)))error('NFS-e sem prestador identificado');
 const number=field(info,'nNFSe');
 if(!/^\d{1,13}$/.test(number))error('Número da NFS-e ausente ou inválido');
 const service=child(dpsInfo,'serv'), codes=child(service,'cServ');
 const total=child(info,'valores'),dpsValues=child(dpsInfo,'valores');
 return {key:accessKey,number,issue:time(field(info,'dhProc')),competence:time(field(dpsInfo,'dCompet')),
  dpsNumber:field(dpsInfo,'nDPS'),dpsSeries:field(dpsInfo,'serie'),
  dpsIssue:time(field(dpsInfo,'dhEmi')),emitter:({1:'Prestador',2:'Tomador',3:'Intermediário'})[field(dpsInfo,'tpEmit')]||field(dpsInfo,'tpEmit'),
  status:field(info,'cStat')==='100'?'Autorizada':field(info,'cStat'),
  purpose:field(chain(dpsInfo,'IBSCBS'),'finNFSe'),
  city:field(info,'xLocEmi'),generator:field(info,'ambGer'),environment,
  issuer,taker:party(child(dpsInfo,'toma')),recipient:party(child(dpsInfo,'dest')),
  intermediary:party(child(dpsInfo,'interm')),
  taxNational:field(codes,'cTribNac'),taxMunicipal:field(codes,'cTribMun'),
  nbs:field(codes,'cNBS'),description:field(codes,'xDescServ'),
  location:first(field(chain(service,'locPrest'),'xLocPrestacao'),field(chain(service,'locPrest'),'cLocPrestacao')),
  iss:child(dpsInfo,'trib'),ibscbs:child(dpsInfo,'IBSCBS'),
  serviceValue:first(field(chain(dpsValues,'vServPrest'),'vServ'),field(total,'vServ')),
  discount:field(chain(dpsValues,'vDescCondIncond'),'vDescIncond'),
  net:first(field(total,'vLiq'),field(chain(total,'vLiq'),'vLiq')),extra:field(dpsInfo,'infCpl')
 };
}
function safe(s){return String(s??'').replace(/[\u0000-\u001f]/g,' ').replace(/[^\x20-\x7e\u00a0-\u00ff]/g,'?');}
const pdfString=s=>safe(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const fmt=x=>Number(x).toFixed(2).replace(/\.00$/,'');
function pdfWriter(){
 const ops=[];
 const Y=t=>HEIGHT-t;
 const fill=(r,g,b)=>ops.push(r+' '+g+' '+b+' rg');
 const stroke=(r,g,b)=>ops.push(r+' '+g+' '+b+' RG');
 const line=(x,y,x2,y2,width=.5)=>{
  stroke(0,0,0);ops.push(fmt(width)+' w '+fmt(x)+' '+fmt(Y(y))+' m '+fmt(x2)+' '+fmt(Y(y2))+' l S');
 };
 const rectangle=(x,top,w,h,{shade=false,border=false}={})=>{
  if(shade){fill(.95,.95,.95);ops.push(fmt(x)+' '+fmt(Y(top+h))+' '+fmt(w)+' '+fmt(h)+' re f');}
  if(border){stroke(0,0,0);ops.push('1 w '+fmt(x)+' '+fmt(Y(top+h))+' '+fmt(w)+' '+fmt(h)+' re S');}
 };
 const text=(value,x,top,{size=7,bold=false,max=95,color='black'}={})=>{
  if(!value)return;
  let t=safe(value);
  // Campos textuais podem ser abreviados com reticências, conforme NT 008.
  const cap=Math.min(max,Math.max(1,Math.floor((WIDTH-x-12)/(size*.53))));
  if(t.length>cap)t=t.slice(0,Math.max(1,cap-3))+'...';
  const colors=color==='red'?'1 0 0':'0 0 0';
  ops.push(colors+' rg BT /'+(bold?'F2':'F1')+' '+fmt(size)+' Tf 1 0 0 1 '+
    fmt(x)+' '+fmt(Y(top+size))+' Tm ('+pdfString(t)+') Tj ET');
 };
 const header=(name,y,h=18)=>{
  rectangle(8.5,y,578.3,h,{shade:true});
  text(name.toUpperCase(),12,y+4,{bold:true,size:7,max:100});
  line(8.5,y+h,586.8,y+h);
 };
 const group=(title,x,y,value,width=140)=>{
  text(title,x,y,{size:6,bold:true,max:56});
  if(value)text(value,x,y+9,{size:7,max:Math.floor(width/3.7)});
 };
 const block=(name,y,p,h=65)=>{
  header(name,y,17);
  if(!p?.id&&!p?.name){
   text(name.toUpperCase()+' NÃO IDENTIFICADO NA NFS-e',12,y+23,{size:7,bold:true,max:80});
  }else{
   group('CNPJ / CPF / NIF',152,y+3,p.id,145);
   group('Inscrição municipal',303,y+3,p.registration,142);
   group('Telefone',460,y+3,p.phone,110);
   group('Nome / Nome empresarial',12,y+20,p.name,285);
   group('Município / UF',302,y+20,p.city,160);
   group('Código IBGE / CEP',464,y+20,[p.cityCode,p.cep].filter(Boolean).join(' / '),120);
   group('Endereço',12,y+38,p.street,355);
   group('E-mail',374,y+38,p.email,205);
  }
  line(8.5,y+h,586.8,y+h);
 };
 return {ops,line,rectangle,text,group,header,block};
}
function toPdf(commands,url){
 const out=[];let position=0;const offsets=[0];
 const put=b=>{const bytes=Buffer.isBuffer(b)?b:Buffer.from(b,'latin1');out.push(bytes);position+=bytes.length;};
 const obj=(n,body)=>{offsets[n]=position;put(n+' 0 obj\n'+body+'\nendobj\n');};
 put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
 obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
 obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] '+
   '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 7 0 R /Annots [6 0 R] >>');
 obj(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 obj(5,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const annotation='<< /Type /Annot /Subtype /Link /Rect [492 715 562 788] /Border [0 0 0] '+
  '/A << /S /URI /URI ('+pdfString(url)+') >> >>';
 obj(6,annotation);
 const bytes=Buffer.from(commands.join('\n')+'\n','latin1');
 offsets[7]=position;put('7 0 obj\n<< /Length '+bytes.length+' >>\nstream\n');
 put(bytes);put('endstream\nendobj\n');
 const xref=position;
 put('xref\n0 8\n0000000000 65535 f \n');
 for(let i=1;i<=7;i++)put(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 put('trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return Buffer.concat(out);
}
function drawQr(ops,key){
 const url='https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave='+key;
 const qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();
 const modules=qr.getModuleCount(),quiet=4, side=66,
   unit=side/(modules+quiet*2),x=499,top=51;
 ops.push('1 1 1 rg '+fmt(x)+' '+fmt(HEIGHT-top-side)+' '+fmt(side)+' '+fmt(side)+' re f');
 ops.push('0 0 0 rg');
 for(let y=0;y<modules;y++)for(let col=0;col<modules;col++)if(qr.isDark(y,col)){
   const px=x+(col+quiet)*unit,py=HEIGHT-(top+(y+quiet+1)*unit);
   ops.push(fmt(px)+' '+fmt(py)+' '+fmt(unit+.035)+' '+fmt(unit+.035)+' re f');
 }
 return url;
}
export function renderNationalDanfse({xml,accessKey,environment,issuerCnpj}={}){
 const data=readXml(xml,accessKey,environment);
 if(issuerCnpj&&digits(data.issuer.id)!==digits(issuerCnpj))
   error('Prestador no XML NFS-e não corresponde ao CNPJ autorizado');
 const p=pdfWriter();
 p.rectangle(5.1,5.1,585.08,831.69,{border:true});
 p.rectangle(8.5,8.5,578.3,36,{shade:true});
 p.text('NFS-e',14,12,{size:16,bold:true,max:30});
 p.text('DANFSe v2.0',218,11,{size:10,bold:true});
 p.text('Documento Auxiliar da NFS-e',199,23,{size:9,bold:true});
 if(environment==='HOMOLOGACAO')
   p.text('NFS-e SEM VALIDADE JURÍDICA',195,34,{size:9,bold:true,color:'red'});
 p.text('Município: '+data.city,447,10,{size:7,max:36});
 p.text('Ambiente gerador: '+data.generator,447,20,{size:6,max:44});
 p.text('Tipo de ambiente: '+(environment==='HOMOLOGACAO'?'Homologação':'Produção'),
   447,29,{size:6,max:40});
 p.line(8.5,46,586.8,46);
 p.group('CHAVE DE ACESSO DA NFS-e',12,49,data.key,485);
 p.group('NÚMERO DA NFS-e',12,73,data.number,146);
 p.group('COMPETÊNCIA DA NFS-e',171,73,data.competence,155);
 p.group('DATA E HORA DA EMISSÃO DA NFS-e',330,73,data.issue,164);
 p.group('NÚMERO DA DPS',12,93,data.dpsNumber,146);
 p.group('SÉRIE DA DPS',171,93,data.dpsSeries,155);
 p.group('DATA E HORA DA EMISSÃO DA DPS',330,93,data.dpsIssue,164);
 p.group('EMITENTE DA NFS-e',12,114,data.emitter,146);
 p.group('SITUAÇÃO DA NFS-e',171,114,data.status,155);
 p.group('FINALIDADE',330,114,data.purpose,164);
 const url=drawQr(p.ops,data.key);
 p.text('A autenticidade desta NFS-e pode ser',491,119,{size:5.6,max:40});
 p.text('verificada pela leitura do QR Code ou',491,127,{size:5.6,max:42});
 p.text('pela chave no portal nacional NFS-e.',491,135,{size:5.6,max:43});
 p.line(8.5,148,586.8,148);
 p.block('Prestador / Fornecedor',149,data.issuer,76);
 const tax=data.issuer.tax;
 p.group('Simples Nacional na data da competência',12,208,field(tax,'opSimpNac'),248);
 p.group('Regime de apuração tributária pelo SN',291,208,field(tax,'regApTribSN'),277);
 p.block('Tomador / Adquirente',226,data.taker,65);
 p.block('Destinatário da operação',292,data.recipient,52);
 p.block('Intermediário da operação',345,data.intermediary,52);
 p.header('Serviço prestado',399,19);
 p.group('Código de tributação nacional / municipal',12,421,
   [data.taxNational,data.taxMunicipal].filter(Boolean).join(' / '),266);
 p.group('Código NBS',298,421,data.nbs,135);
 p.group('Local da prestação',448,421,data.location,128);
 p.group('Descrição do serviço',12,445,data.description,565);
 p.line(8.5,503,586.8,503);
 p.header('Tributação municipal (ISSQN)',505,17);
 const iss=child(data.iss,'tribMun');
 p.group('Tipo de tributação do ISSQN',12,524,field(iss,'tribISSQN'),170);
 p.group('Município de incidência',214,524,field(iss,'cLocIncid'),182);
 p.group('Base de cálculo ISSQN',12,542,money(field(iss,'vBC')),169);
 p.group('Alíquota aplicada',214,542,field(iss,'pAliq'),148);
 p.group('ISSQN apurado',433,542,money(field(iss,'vISSQN')),136);
 p.line(8.5,566,586.8,566);
 p.header('Tributação federal (exceto CBS)',567,18);
 const fed=child(data.iss,'tribFed');
 p.group('IRRF',12,587,money(field(fed,'vIRRF')),155);
 p.group('Contribuição previdenciária - retida',214,587,money(field(fed,'vRetCP')),210);
 p.group('Contribuições sociais - retidas',433,587,money(field(fed,'vRetCSLL')),136);
 p.line(8.5,609,586.8,609);
 p.header('Tributação IBS / CBS',610,18);
 const ibs=data.ibscbs;
 p.group('CST / cClassTrib',12,630,[field(ibs,'CST'),field(ibs,'cClassTrib')].filter(Boolean).join(' / '),217);
 p.group('Indicador de operação',243,630,field(ibs,'indOp'),166);
 p.group('Município de incidência',421,630,field(ibs,'cMunIncid'),151);
 p.group('Base de cálculo após reduções',12,649,money(field(ibs,'vBC')),201);
 p.group('Valor total do IBS',243,649,money(field(ibs,'vIBS')),166);
 p.group('Valor total da CBS',421,649,money(field(ibs,'vCBS')),151);
 p.line(8.5,671,586.8,671);
 p.header('Valor total da NFS-e',672,18);
 p.group('Valor da operação / serviço',12,693,money(data.serviceValue),190);
 p.group('Desconto incondicionado',243,693,money(data.discount),166);
 p.group('Valor líquido da NFS-e',421,693,money(data.net),150);
 p.line(8.5,720,586.8,720);
 p.header('Informações complementares',721,18);
 p.text(data.extra,12,743,{size:7,max:145});
 p.line(8.5,822,586.8,822);
 p.text('Chave de acesso: '+data.key,12,824,{size:6,max:104});
 p.text('DANFSe gerado localmente a partir do XML autorizado',370,824,{size:5.8,max:54});
 const pdf=toPdf(p.ops,url);
 if(pdf.length>6*1024*1024)error('DANFSe local excede o limite de 6 MiB');
 return pdf;
}
