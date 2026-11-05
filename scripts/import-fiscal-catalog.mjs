#!/usr/bin/env node
// Importador offline para CSV *normalizado pela ArtiSys* a partir dos arquivos
// originais oficiais. Não baixa nem presume atualizações, versões ou alíquotas.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadFiscalCatalog} from '../src/platform/fiscal-official-catalog.js';
const fail=message=>{throw new Error(message);};
const options={};
for(let i=2;i<process.argv.length;i+=2){
 const name=process.argv[i]?.replace(/^--/,'');
 if(!name||!process.argv[i]?.startsWith('--')||!process.argv[i+1])
  fail('Uso: --ncm --cfop --ibscbs --sources --out --checked-at');
 options[name]=process.argv[i+1];
}
for(const name of ['ncm','cfop','ibscbs','sources','out','checked-at'])
 if(!options[name])fail('Parâmetro ausente: '+name);
const read=path=>{
 const data=readFileSync(path,'utf8').replace(/^\uFEFF/,'');
 if(Buffer.byteLength(data)>4*1024*1024)fail('Entrada maior que 4MB');
 return data.trim().split(/\r?\n/).filter(Boolean).map(line=>
  line.trim().split(/[;,]/).map(field=>field.trim().replace(/^"|"$/g,'')));
};
const codes=(file,header,pattern)=>{
 const rows=read(file);
 if(rows[0]?.[0]?.toUpperCase()!==header)fail('Cabeçalho esperado: '+header);
 const values=rows.slice(1).map(row=>row[0]);
 if(!values.length||values.some(code=>!pattern.test(code)))fail('Código inválido na tabela '+header);
 return [...new Set(values)].sort();
};
const ncm=codes(options.ncm,'NCM',/^\d{8}$/);
const cfop=codes(options.cfop,'CFOP',/^[567]\d{3}$/);
const rows=read(options.ibscbs);
if(rows[0]?.join(',')!=='CST,cClassTrib,regime,reduction,deferral')
 fail('Cabeçalho IBS/CBS inválido: CST,cClassTrib,regime,reduction,deferral');
const ibscbs=rows.slice(1).map(row=>{
 if(row.length!==5||!['true','false'].includes(row[3])||!['true','false'].includes(row[4]))
  fail('Indicadores IBS/CBS inválidos; usar true/false explícitos');
 return {cst:row[0],cClassTrib:row[1],regime:row[2],
  reduction:row[3]==='true',deferral:row[4]==='true'};
}).sort((a,b)=>a.cClassTrib.localeCompare(b.cClassTrib));
let sources;
try{sources=JSON.parse(readFileSync(options.sources,'utf8'));}catch{fail('Metadados de proveniência não são JSON válido');}
const payload={schemaVersion:1,checkedAt:options['checked-at'],sources,tables:{ncm,cfop,ibscbs}};
const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
writeFileSync(options.out,JSON.stringify({...payload,digest},null,2)+'\n',{flag:'wx'});
try{
 loadFiscalCatalog({path:options.out,now:options['checked-at']});
}catch(error){fail('Importação recusada: '+error.message);}
process.stdout.write('Catálogo gerado. NCM '+ncm.length+', CFOP '+cfop.length+
 ', cClassTrib '+ibscbs.length+'. SHA-256 '+digest+'\n');
