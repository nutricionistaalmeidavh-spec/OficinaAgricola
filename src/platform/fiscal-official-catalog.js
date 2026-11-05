// Catálogos fiscais versionados, preparados a partir de fontes oficiais fora do
// runtime. O checksum verifica integridade local, NÃO atesta autenticidade do fornecedor.
import {readFileSync,statSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const fail=message=>{throw new Error(message);};
const code=(value,pattern,label)=>{
 const result=String(value??'').trim();
 if(!pattern.test(result))fail(label+' inválido no catálogo fiscal');
 return result;
};
const officialUrl=value=>{
 let u;
 try{u=new URL(String(value));}catch{fail('Origem do catálogo: URL inválida');}
 if(u.protocol!=='https:'||u.username||u.password||
    !(/(^|\.)gov\.br$/i.test(u.hostname)||/(^|\.)fazenda\.gov\.br$/i.test(u.hostname)))
   fail('Origem do catálogo não é fonte oficial HTTPS');
 return u.href;
};
const stamp=(date,label)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date))||
     new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
   fail(label+' inválida');
 return Date.parse(date+'T00:00:00Z');
};
function validateDateWindow(bundle,now,maxAgeDays){
 const checked=stamp(bundle.checkedAt,'Data de revisão do catálogo');
 const today=stamp(now,'Data da validação');
 const days=(today-checked)/86400000;
 if(days>maxAgeDays||days<0)fail('Catálogo fiscal desatualizado ou revisão futura: atualize as tabelas oficiais');
}
export function loadFiscalCatalog({path,now=new Date().toISOString().slice(0,10),maxAgeDays=60}={}){
 if(typeof path!=='string'||!path||statSync(path).size>5*1024*1024)
   fail('Arquivo do catálogo fiscal obrigatório e limitado a 5 MB');
 let raw;
 try{raw=JSON.parse(readFileSync(path,'utf8'));}catch{fail('Arquivo JSON do catálogo fiscal inválido');}
 if(raw?.schemaVersion!==1||!raw.sources||!raw.tables||!Array.isArray(raw.tables.ibscbs))
   fail('Estrutura do catálogo fiscal inválida');
 const {schemaVersion,checkedAt,sources,tables,digest}=raw;
 if(!/^[0-9a-f]{64}$/.test(String(digest||'')))fail('Digest do catálogo fiscal inválido');
 const actual=createHash('sha256').update(JSON.stringify({schemaVersion,checkedAt,sources,tables})).digest('hex');
 if(actual!==digest)fail('Falha de integridade SHA-256 do catálogo fiscal');
 validateDateWindow(raw,now,maxAgeDays);
 for(const name of ['ncm','cfop','ibscbs']){
  const meta=sources[name];
  if(!meta||typeof meta.version!=='string'||!meta.version.trim())
    fail('Versão de fonte oficial '+name+' ausente');
  officialUrl(meta.url);
  stamp(meta.publishedAt,'Data da tabela '+name);
  if(!Array.isArray(tables[name])||!tables[name].length||tables[name].length>25000)
    fail('Catálogo fiscal '+name+' vazio ou excessivo');
 }
 if(new Set(tables.ncm).size!==tables.ncm.length||new Set(tables.cfop).size!==tables.cfop.length)
   fail('Catálogo fiscal contém códigos duplicados');
 for(const ncm of tables.ncm)code(ncm,/^\d{8}$/,'NCM');
 // A fonte oficial traz todos os CFOP de entrada (1/2/3) e saída (5/6/7).
 // A emissão continua validando somente CFOP de saída no documento.
 for(const cfop of tables.cfop)code(cfop,/^[123567]\d{3}$/,'CFOP');
 const rows=new Set();
 for(const item of tables.ibscbs){
  if(!item||typeof item!=='object')fail('Registro IBS/CBS inválido');
  const cst=code(item.cst,/^\d{3}$/,'CST IBS/CBS');
  const classification=code(item.cClassTrib,/^\d{6}$/,'cClassTrib');
  if(!classification.startsWith(cst))fail('CST e cClassTrib divergentes no catálogo');
  if(!['REGULAR','REDUCAO','DIFERIMENTO','ESPECIAL'].includes(item.regime)||
     typeof item.reduction!=='boolean'||typeof item.deferral!=='boolean')
    fail('Metadados de regime IBS/CBS inválidos');
  if(rows.has(classification))fail('cClassTrib duplicado no catálogo');
  rows.add(classification);
 }
 return Object.freeze({schemaVersion,checkedAt,sources,tables,digest});
}
export function validateFiscalClassification({catalog,ncm,cfop,cst,cClassTrib}={}){
 if(!catalog?.tables)fail('Catálogo oficial local obrigatório para validar a classificação fiscal');
 const itemNcm=code(ncm,/^\d{8}$/,'NCM');
 const itemCfop=code(cfop,/^[567]\d{3}$/,'CFOP');
 if(!catalog.tables.ncm.includes(itemNcm))fail('NCM não encontrado no catálogo fiscal vigente');
 if(!catalog.tables.cfop.includes(itemCfop))fail('CFOP não encontrado no catálogo fiscal vigente');
 if(cst===undefined&&cClassTrib===undefined)return null;
 const tax=code(cst,/^\d{3}$/,'CST IBS/CBS');
 const cls=code(cClassTrib,/^\d{6}$/,'cClassTrib');
 const row=catalog.tables.ibscbs.find(v=>v.cst===tax&&v.cClassTrib===cls);
 if(!row)fail('cClassTrib/CST não encontrado na tabela fiscal vigente');
 return Object.freeze({...row});
}
// O instalador já inclui o snapshot oficial no ASAR (dist/src/platform/fiscal-data).
// Nenhum diretório de tabela precisa ser escolhido pelo cliente final.
export function bundledFiscalCatalogPath(){
 return fileURLToPath(new URL('./fiscal-data/catalog.json',import.meta.url));
}
export function loadConfiguredFiscalCatalog({
 now=new Date().toISOString().slice(0,10),
 bundledPath=bundledFiscalCatalogPath()
}={}){
 const external=process.env.OFICINA_FISCAL_CATALOG_PATH;
 if(external)return loadFiscalCatalog({path:external,now});
 return existsSync(bundledPath)?loadFiscalCatalog({path:bundledPath,now}):null;
}
