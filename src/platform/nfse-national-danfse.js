// DANFSe v2.0 local: layout da NT 008/2026 v1.02, uma folha A4.
// Core 100% local: XML autorizado, PDF vetorial e QR MIT, sem consulta à API DANFSe suspensa.
import {DOMParser} from '@xmldom/xmldom';
import qrcode from 'qrcode-generator';
import {nationalDanfseLogo,decodeNationalLogoPng} from './nfse-national-danfse-assets.js';
import {loadDanfseFonts} from './nfse-national-danfse-fonts.js';

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
  issuer,taker:party(child(dpsInfo,'toma')),recipient:party(child(child(dpsInfo,'IBSCBS'),'dest')),
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
 const text=(value,x,top,{size=7,bold=false,max=95,color='black',arial=false,width=575-x}={})=>{
  if(!value)return;
  let t=safe(value);
  const cap=Math.min(max,Math.max(1,Math.floor(width/(size*.53))));
  if(t.length>cap)t=t.slice(0,Math.max(1,cap-3))+'...';
  const colors=color==='red'?'1 0 0':'0 0 0',font=bold?'F2':arial?'F3':'F1';
  ops.push(colors+' rg BT /'+font+' '+fmt(size)+' Tf 1 0 0 1 '+
    fmt(x)+' '+fmt(Y(top+size))+' Tm ('+pdfString(t)+') Tj ET');
 };
 const paragraph=(value,x,y,{size=7,width=570,maxLines=7,lineHeight=9}={})=>{
  if(!value)return;
  const cap=Math.max(8,Math.floor(width/(size*.53))),tokens=safe(value).split(/\s+/).filter(Boolean);
  const lines=[];let current='';
  for(const word of tokens){
    if(!current){current=word;continue;}
    if(current.length+1+word.length<=cap)current+=' '+word;
    else {lines.push(current);current=word;}
  }
  if(current)lines.push(current);
  // Não inventar conteúdo. Conforme NT, reticências sinalizam truncamento.
  if(lines.length>maxLines){
    lines.length=maxLines;
    lines[maxLines-1]=lines[maxLines-1].slice(0,Math.max(1,cap-3))+'...';
  }
  for(const [i,line] of lines.entries())
    text(line,x,y+i*lineHeight,{size,max:cap,width});
 };
 const header=(name,y,h=17)=>{
  rectangle(8.5,y,578.3,h,{shade:true});
  text(name.toUpperCase(),12,y+4,{bold:true,size:7,max:97,width:560});
  line(8.5,y+h,586.8,y+h,.5);
 };
 const group=(title,x,y,value,width=140,{identification=false}={})=>{
  text(identification?title.toUpperCase():title,x,y,{size:identification?7:6,bold:true,max:95,width:width-4});
  if(value)text(value,x,y+9,{size:7,max:160,width:width-4});
 };
 // Blocos conforme Anexo I: nome na primeira coluna cinza; outras colunas na mesma linha.
 const block=(name,y,p,h=55)=>{
  rectangle(8.5,y,143,18,{shade:true});
  text(name.toUpperCase(),12,y+3,{bold:true,size:7,max:29,width:137});
  if(!p?.id&&!p?.name){
   text(name.toUpperCase()+' NÃO IDENTIFICADO NA NFS-e',12,y+21,{size:7,max:95,width:560});
  }else{
   group('CNPJ / CPF / NIF',152,y+1,p.id,144);
   group('Indicador Municipal (Inscrição)',298,y+1,p.registration,148);
   group('Telefone',449,y+1,p.phone,133);
   group('Nome / Nome empresarial',12,y+19,p.name,283);
   group('Município / Sigla UF',298,y+19,p.city,148);
   group('Código IBGE / CEP',449,y+19,[p.cityCode,p.cep].filter(Boolean).join(' / '),132);
   group('Endereço',12,y+37,p.street,282);
   group('E-mail',298,y+37,p.email,283);
  }
  line(8.5,y+h,586.8,y+h,.5);
 };
 return {ops,line,rectangle,text,paragraph,group,header,block};
}
function toPdf(commands,url,logo){
 const fonts=loadDanfseFonts();
 const out=[];let position=0;const offsets=[0];
 const put=b=>{const bytes=Buffer.isBuffer(b)?b:Buffer.from(b,'latin1');out.push(bytes);position+=bytes.length;};
 const obj=(n,body)=>{offsets[n]=position;put(n+' 0 obj\n'+body+'\nendobj\n');};
 const streamObject=(n,dict,data)=>{
   offsets[n]=position;
   put(n+' 0 obj\n<< '+dict+' /Length '+data.length+' >>\nstream\n');
   put(data);put('\nendstream\nendobj\n');
 };
 function embedFont(fontNumber,descNumber,fileNumber,baseFont,font){
   const fontName=baseFont.replace(/[^A-Za-z0-9-]/g,'');
   obj(fontNumber,'<< /Type /Font /Subtype /TrueType /BaseFont /'+fontName+
    ' /FirstChar 32 /LastChar 255 /Widths ['+font.widths.join(' ')+']'+
    ' /FontDescriptor '+descNumber+' 0 R /Encoding /WinAnsiEncoding >>');
   obj(descNumber,'<< /Type /FontDescriptor /FontName /'+fontName+
    ' /Flags 32 /FontBBox ['+font.bbox.join(' ')+'] /ItalicAngle 0'+
    ' /Ascent '+font.ascender+' /Descent '+font.descender+
    ' /CapHeight '+font.capHeight+' /StemV 80 /FontFile2 '+fileNumber+' 0 R >>');
   streamObject(fileNumber,'/Length1 '+font.data.length+' /Filter /FlateDecode',font.compressed);
 }
 put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
 obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
 obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] '+
   '/Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 8 0 R >> '+
   '/XObject << /ImLogo 9 0 R >> >> /Contents 7 0 R /Annots [6 0 R] >>');
 // Fontes realmente embutidas a partir do sistema local; nunca distribuí-las separadamente.
 embedFont(4,10,11,'MicrosoftSansSerif',fonts.content);
 embedFont(5,12,13,'Arial-BoldMT',fonts.label);
 const annotation='<< /Type /Annot /Subtype /Link /Rect [495 731 559 795] /Border [0 0 0] '+
  '/A << /S /URI /URI ('+pdfString(url)+') >> >>';
 obj(6,annotation);
 const bytes=Buffer.from(commands.join('\n')+'\n','latin1');
 streamObject(7,'',bytes);
 embedFont(8,14,15,'ArialMT',fonts.arial);
 streamObject(9,'/Type /XObject /Subtype /Image /Width '+logo.width+' /Height '+
  logo.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode',logo.stream);
 const xref=position;
 put('xref\n0 16\n0000000000 65535 f \n');
 for(let i=1;i<=15;i++)put(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 put('trailer\n<< /Size 16 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return Buffer.concat(out);
}
function drawQr(ops,key){
 const url='https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave='+key;
 const qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();
 // Coordenadas normativas: 17,48cm x 1,67cm (origem no topo esquerdo),
 // QR com lado >=1,52cm; usar 1,59cm para caber na identificação A4.
 const modules=qr.getModuleCount(),quiet=4,side=45,
   unit=side/(modules+quiet*2),x=495.50,top=47.34;
 ops.push('1 1 1 rg '+fmt(x)+' '+fmt(HEIGHT-top-side)+' '+fmt(side)+' '+fmt(side)+' re f');
 ops.push('0 0 0 rg');
 for(let y=0;y<modules;y++)for(let col=0;col<modules;col++)if(qr.isDark(y,col)){
   const px=x+(col+quiet)*unit,py=HEIGHT-(top+(y+quiet+1)*unit);
   ops.push(fmt(px)+' '+fmt(py)+' '+fmt(unit+.035)+' '+fmt(unit+.035)+' re f');
 }
 return url;
}
export function renderNationalDanfse({xml,accessKey,environment,issuerCnpj,logoPng}={}){
 const data=readXml(xml,accessKey,environment);
 if(issuerCnpj&&digits(data.issuer.id)!==digits(issuerCnpj))
   error('Prestador no XML NFS-e não corresponde ao CNPJ autorizado');
 const logo=decodeNationalLogoPng(nationalDanfseLogo({logoPng}));
 const p=pdfWriter();
 p.rectangle(5.1,5.1,585.08,831.69,{border:true});
 p.rectangle(8.5,8.5,578.3,36,{shade:true});
 // Logomarca horizontal original, área normativa 0,85 x 4,00 cm, x=0,49cm, y=0,44cm.
 const logoScale=Math.min(113.39/logo.width,24.09/logo.height);
 const lw=logo.width*logoScale,lh=logo.height*logoScale,lx=13.89+(113.39-lw)/2;
 const ly=HEIGHT-(12.47+(24.09-lh)/2)-lh;
 p.ops.push('q '+fmt(lw)+' 0 0 '+fmt(lh)+' '+fmt(lx)+' '+fmt(ly)+' cm /ImLogo Do Q');
 // Cabeçalho: área central de 10,19 cm e área direita de 5,09 cm.
 p.text('DANFSe v2.0',230,9,{size:9,bold:true,max:30,width:178});
 p.text('Documento Auxiliar da NFS-e',198,20,{size:9,bold:true,max:44,width:233});
 if(environment==='HOMOLOGACAO')
   p.text('NFS-e SEM VALIDADE JURÍDICA',196,30,{size:9,bold:true,color:'red',max:43,width:242});
 if(data.city)p.text('Município: '+data.city,443,9,{size:8,max:36,width:135});
 p.text('Ambiente Gerador: '+data.generator,443,21,{size:6,max:38,width:137});
 p.text('Tipo de Ambiente: '+(environment==='HOMOLOGACAO'?'Homologação':'Produção'),
   443,29,{size:6,max:38,width:137});
 p.line(8.5,41.4,586.8,41.4);
 // Identificação da NFS-e: três colunas de 5,09 cm; QR na área da direita.
 const ident={identification:true};
 p.group('Chave de acesso da NFS-e',12,43,data.key,429,ident);
 p.group('Número da NFS-e',12,65,data.number,141,ident);
 p.group('Competência da NFS-e',156,65,data.competence,142,ident);
 p.group('Data e hora da emissão da NFS-e',301,65,data.issue,144,ident);
 p.group('Número da DPS',12,84,data.dpsNumber,141,ident);
 p.group('Série da DPS',156,84,data.dpsSeries,142,ident);
 p.group('Data e hora da emissão da DPS',301,84,data.dpsIssue,144,ident);
 p.rectangle(8.5,104,145,18,{shade:true});
 p.group('Emitente da NFS-e',12,105,data.emitter,141,ident);
 p.group('Situação da NFS-e',156,105,data.status,142,ident);
 p.group('Finalidade',301,105,data.purpose,144,ident);
 const url=drawQr(p.ops,data.key);
 p.text('A autenticidade desta NFS-e pode ser',451,96,{size:6,max:61,width:132});
 p.text('verificada pela leitura deste código QR ou',451,104,{size:6,max:61,width:132});
 p.text('pela consulta da chave no portal da NFS-e',451,112,{size:6,max:61,width:132});
 p.line(8.5,123,586.8,123);
 p.block('Prestador / Fornecedor',124,data.issuer,73);
 const tax=data.issuer.tax;
 p.group('Simples Nacional na data da competência',12,179,field(tax,'opSimpNac'),277);
 p.group('Regime de apuração tributária pelo SN',298,179,field(tax,'regApTribSN'),283);
 p.block('Tomador / Adquirente',198,data.taker,55);
 p.block('Destinatário da operação',254,data.recipient,55);
 p.block('Intermediário da operação',310,data.intermediary,55);
 p.header('Serviço prestado',366,18);
 p.group('Código de tributação nacional / municipal',12,387,
   [data.taxNational,data.taxMunicipal].filter(Boolean).join(' / '),284);
 p.group('Código NBS',301,387,data.nbs,140);
 p.group('Local da prestação / Sigla UF / País',448,387,data.location,133);
 p.group('Descrição do serviço',12,413,'',568);
 p.paragraph(data.description,12,426,{size:7,width:565,maxLines:6,lineHeight:9});
 p.line(8.5,485,586.8,485);
 p.header('Tributação municipal (ISSQN)',486,17);
 const iss=child(data.iss,'tribMun');
 p.group('Tipo de tributação do ISSQN',12,505,field(iss,'tribISSQN'),285);
 p.group('Município / Sigla UF / País de incidência',302,505,field(iss,'cLocIncid'),278);
 p.group('Regime especial de tributação',12,522,field(iss,'tpRetISSQN'),142);
 p.group('Tipo de imunidade do ISSQN',155,522,field(iss,'tpImunidade'),143);
 p.group('Suspensão da exigibilidade',302,522,field(iss,'tpSusp'),143);
 p.group('Número processo suspensão',450,522,field(iss,'nProcesso'),128);
 p.group('Benefício municipal',12,539,field(iss,'cBM'),142);
 p.group('Cálculo do BM',155,539,field(iss,'vBM'),143);
 p.group('Total deduções / reduções',302,539,money(field(iss,'vDeducoes')),143);
 p.group('Desconto incondicionado',450,539,money(data.discount),128);
 p.group('BC ISSQN',12,556,money(field(iss,'vBC')),142);
 p.group('Alíquota aplicada',155,556,field(iss,'pAliq'),143);
 p.group('Retenção do ISSQN',302,556,field(iss,'tpRetISSQN'),143);
 p.group('ISSQN apurado',450,556,money(field(iss,'vISSQN')),128);
 p.line(8.5,578,586.8,578);
 p.header('Tributação federal (exceto CBS)',579,17);
 const fed=child(data.iss,'tribFed');
 p.group('IRRF',12,598,money(field(fed,'vIRRF')),143);
 p.group('Contribuição previdenciária - retida',155,598,money(field(fed,'vRetCP')),286);
 p.group('Contribuições sociais - retidas',450,598,money(field(fed,'vRetCSLL')),128);
 p.group('PIS - débito apuração própria',12,615,money(field(fed,'vPis')),143);
 p.group('COFINS - débito apuração própria',155,615,money(field(fed,'vCofins')),286);
 p.group('Descrição das contribuições sociais retidas',450,615,field(fed,'tpRetPisCofins'),128);
 p.line(8.5,637,586.8,637);
 p.header('Tributação IBS / CBS',638,17);
 const ibs=data.ibscbs;
 p.group('CST / cClassTrib',12,658,[field(ibs,'CST'),field(ibs,'cClassTrib')].filter(Boolean).join(' / '),142);
 p.group('Indicador de operação / Código IBGE',155,658,
   [field(ibs,'indOp'),field(ibs,'cMunIncid')].filter(Boolean).join(' / '),285);
 p.group('Exclusões e reduções da base de cálculo',450,658,money(field(ibs,'vRed')),128);
 p.group('Base de cálculo após exclusões',12,675,money(field(ibs,'vBC')),142);
 p.group('Redução alíquota IBS / CBS',155,675,field(ibs,'pRedAliq'),285);
 p.group('Valor total IBS',450,675,money(field(ibs,'vIBS')),128);
 p.line(8.5,698,586.8,698);
 p.header('Valor total da NFS-e',699,17);
 p.group('Valor da operação / serviço',12,719,money(data.serviceValue),142);
 p.group('Desconto incondicionado',155,719,money(data.discount),143);
 p.group('Valor líquido da NFS-e',302,719,money(data.net),143);
 p.group('Total IBS/CBS',450,719,money(field(ibs,'vIBSCBS')),128);
 p.line(8.5,743,586.8,743);
 p.header('Informações complementares',744,17);
 p.paragraph(data.extra,12,765,{size:7,width:568,maxLines:6,lineHeight:9});
 p.line(8.5,826,586.8,826);
 p.text('NFS-e '+data.number+' / '+data.key,12,827,{size:6,max:105,width:570});
 const pdf=toPdf(p.ops,url,logo);
 if(pdf.length>6*1024*1024)error('DANFSe local excede o limite de 6 MiB');
 return pdf;
}
