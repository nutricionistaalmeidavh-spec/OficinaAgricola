import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocalFiscalTaxStore} from '../src/platform/local-fiscal-tax-store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const issuer={cnpj:'11222333000181',uf:'MG',municipalityIbge:'3106200',taxRegime:'SIMPLES'};
test('perfil tributário é armazenado em diretório privado e não migra entre CNPJs',()=>{
 const root=mkdtempSync(join(tmpdir(),'tax-assist-'));
 try{
   const first=createLocalFiscalTaxStore({directory:join(root,'empresa1'),inputDir:root});
   const second=createLocalFiscalTaxStore({directory:join(root,'empresa2'),inputDir:root});
   const p=first.saveProfile({issuer,profile:{kind:'GOODS',name:'Filtro',ncm:'84212300',
     cfop:'5102',origin:'0',icmsScheme:'CSOSN',icmsCode:'102',
     pisCst:'49',cofinsCst:'49',unit:'UN'}});
   assert.equal(first.listProfiles({issuer})[0].id,p.id);
   assert.deepEqual(second.listProfiles({issuer}),[]);
   assert.throws(()=>first.listProfiles({issuer:{...issuer,cnpj:'99888777000166'}}),/CNPJ/);
 }finally{rmSync(root,{force:true,recursive:true});}
});
test('a tela expõe cadastro, revisão por documento e serviço municipal, sem editor de INI',()=>{
 const ui=readFileSync(new URL('../public/app-fiscal.js',import.meta.url),'utf8');
 assert.match(ui,/\/api\/fiscal\/tax\/profiles/);
 assert.match(ui,/\/api\/fiscal\/\S+tax-review/);
 assert.match(ui,/municipalServiceCode/);
 assert.match(ui,/icmsScheme/);
 assert.doesNotMatch(ui,/textarea[^>]*name=['"]iniSource/);
});
