import {createHash} from 'node:crypto';

// Importação de dados bancários, sem chamadas externas nem dependências.
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const clean=value=>String(value??'').trim();
const MAX_BYTES=1024*1024;
const MAX_ROWS=1000;
const digest=value=>createHash('sha256').update(value).digest('hex');
function day(value,ofx=false){
 const raw=clean(value);
 const candidate=ofx?raw.slice(0,8):raw;
 let yy,mm,dd;
 if(/^\d{4}-\d{2}-\d{2}$/.test(candidate)) [yy,mm,dd]=candidate.split('-');
 else if(/^\d{2}\/\d{2}\/\d{4}$/.test(candidate)) [dd,mm,yy]=candidate.split('/');
 else if(/^\d{8}$/.test(candidate)) [yy,mm,dd]=[candidate.slice(0,4),candidate.slice(4,6),candidate.slice(6,8)];
 else fail('Data bancária inválida');
 const iso=yy+'-'+mm+'-'+dd,actual=new Date(iso+'T12:00:00.000Z');
 if(!Number.isFinite(actual.getTime())||actual.toISOString().slice(0,10)!==iso)fail('Data bancária inválida');
 return iso;
}
function cents(value){
 let v=clean(value).replace(/^R\$\s*/i,'').replace(/\s/g,'');
 let negative=false;
 if(/^\(.*\)$/.test(v)){negative=true;v=v.slice(1,-1);}
 if(v.startsWith('-')){negative=!negative;v=v.slice(1);}
 if(v.startsWith('+'))v=v.slice(1);
 if(v.endsWith('-')){negative=!negative;v=v.slice(0,-1);}
 if(!/^[0-9.,]+$/.test(v))fail('Valor bancário inválido');
 const comma=v.lastIndexOf(','),dot=v.lastIndexOf('.');
 const point=Math.max(comma,dot);
 let whole=v,fraction='00';
 if(point>=0){
  whole=v.slice(0,point);
  fraction=v.slice(point+1);
  if(fraction.length<1||fraction.length>2)fail('Valor bancário possui decimais inválidos ou ambíguos');
  const separator=v[point],group=separator===','?'.':',';
  if(whole.includes(separator))fail('Agrupamento bancário inválido');
  if(whole.includes(group)){
   const groups=whole.split(group);
   if(!/^\d{1,3}$/.test(groups[0])||!groups.slice(1).every(x=>/^\d{3}$/.test(x)))
    fail('Agrupamento bancário inválido');
   whole=groups.join('');
  }
 }else if(!/^\d+$/.test(whole))fail('Valor bancário inválido');
 if(!/^\d+$/.test(whole))fail('Valor bancário inválido');
 fraction=fraction.padEnd(2,'0');
 const amount=BigInt(whole)*100n+BigInt(fraction);
 if(amount>BigInt(Number.MAX_SAFE_INTEGER)||amount===0n)fail('Valor bancário fora do limite');
 return Number(negative?-amount:amount);
}
function csvRows(text,delimiter){
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){
   if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
   else if(ch==='"') {quoted=false;closed=true;}
   else cell+=ch;
  }else if(ch==='"'&&cell===''&&!closed)quoted=true;
  else if(ch===delimiter){row.push(cell);cell='';closed=false;}
  else if(ch==='\n'||ch==='\r'){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   row.push(cell); if(row.some(x=>x.trim()))rows.push(row);
   row=[];cell='';closed=false;
   if(rows.length>MAX_ROWS+1)fail('Limite de linhas de extrato excedido');
  }else{
   if(closed&&!/\s/.test(ch))fail('CSV contém aspas inválidas');
   cell+=ch;
  }
 }
 if(quoted)fail('CSV contém aspas sem fechamento');
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length>MAX_ROWS+1)fail('Limite de linhas de extrato excedido');
 return rows;
}
function separatorOf(header){
 let delim=',',counts={',':0,';':0,'\t':0},quoted=false;
 for(const ch of header){
  if(ch==='"')quoted=!quoted;
  else if(!quoted&&Object.hasOwn(counts,ch))counts[ch]++;
 }
 if(counts[';']>counts[','])delim=';';
 if(counts['\t']>counts[delim])delim='\t';
 return delim;
}
function column(raw){return clean(raw).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]/g,'');}
function fromCsv(source){
 const raw=source.replace(/^\uFEFF/,'');
 const rows=csvRows(raw,separatorOf(raw.split(/\r?\n/,1)[0]));
 if(rows.length<2)fail('CSV sem lançamentos');
 const header=rows.shift().map(column);
 const index=(names)=>header.findIndex(x=>names.includes(x));
 const date=index(['data','date','dtlancamento','datalancamento','dtmovimento','datamovimento']);
 const amount=index(['valor','amount','valorbrl','valorrs','montante']);
 const description=index(['descricao','description','historico','memo','detalhe','lancamento']);
 const ref=index(['id','identificador','fitid','transacao','transacaoid','transactionid','referencia','nsu']);
 if(date<0||amount<0)fail('CSV precisa de colunas Data e Valor');
 return rows.map((values,i)=>{
  if(values.length!==header.length)fail('CSV com colunas inconsistentes na linha '+(i+2));
  const bookedAt=day(values[date]),amountCents=cents(values[amount]);
  const desc=description<0?'':clean(values[description]);
  return {bookedAt,amountCents,description:desc,externalId:ref<0?'':clean(values[ref])};
 });
}
function ofxField(block,name){
 const m=block.match(new RegExp('<'+name+'\\b[^>]*>\\s*([^<\\r\\n]+)','i'));
 return clean(m?.[1]??'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function fromOfx(raw){
 const result=[];
 const blocks=[...raw.matchAll(/<STMTTRN\b[^>]*>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN\b)|$)/gi)];
 if(!blocks.length)fail('OFX sem lançamentos STMTTRN');
 if(blocks.length>MAX_ROWS)fail('Limite de linhas de extrato excedido');
 for(const match of blocks){
  const body=match[1],fitid=ofxField(body,'FITID');
  if(!fitid)fail('OFX sem FITID não pode ser importado com segurança');
  const desc=ofxField(body,'MEMO')||ofxField(body,'NAME')||ofxField(body,'TRNTYPE');
  result.push({bookedAt:day(ofxField(body,'DTPOSTED'),true),
   amountCents:cents(ofxField(body,'TRNAMT')),description:desc,externalId:fitid});
 }
 return result;
}
export function parseBankStatementFile({format,content,bankAccount}={}){
 const type=clean(format).toUpperCase(),account=clean(bankAccount);
 if(!account||account.length>80||/[\x00-\x1f]/.test(account))fail('Conta bancária inválida');
 if(!['CSV','OFX'].includes(type))fail('Formato suportado: CSV ou OFX');
 if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>MAX_BYTES||content.length===0)
  fail('Arquivo de extrato vazio ou acima do limite de 1 MB');
 const entries=type==='CSV'?fromCsv(content):fromOfx(content);
 const collisions=new Map();
 for(const row of entries){
  if(row.description.length>300)row.description=row.description.slice(0,300);
  if(row.externalId){
   if(row.externalId.length>128)fail('Identificador bancário excede limite');
  }else{
   // CSV pode não conter FITID: ID determinístico inclui ocorrência para
   // não apagar lançamentos iguais repetidos no mesmo arquivo.
   const fingerprint=digest(JSON.stringify([account,row.bookedAt,row.amountCents,row.description]));
   const occurrence=(collisions.get(fingerprint)||0)+1;collisions.set(fingerprint,occurrence);
   row.externalId='csv-'+fingerprint.slice(0,48)+'-'+occurrence;
  }
  row.bankAccount=account;
 }
 return entries;
}
