import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAcbrLibFiscalProvider} from '../src/platform/acbrlib-fiscal-provider.js';

const issuer={cnpj:'11222333000181',uf:'SP',municipalityIbge:'3550308',
 taxRegime:'SIMPLES',stateRegistration:'12345678',environment:'HOMOLOGACAO'};
const company={legalName:'Oficina QA LTDA',street:'Rua Central',number:'10',
 district:'Centro',city:'São Paulo',zip:'01001000'};
const customer={name:'Comprador',street:'Rua Norte',number:'30',
 district:'Centro',city:'São Paulo',uf:'SP',municipalityIbge:'3550308',zip:'01001001'};
const goods={kind:'GOODS',name:'Mercadorias de teste',
 ncm:'84212300',cfop:'5102',origin:'0',icmsScheme:'CSOSN',icmsCode:'102',
 pisCst:'49',cofinsCst:'49',unit:'UN'};
function fixture({kind='NFE',id=12,amount=9000,discount=1000}={}){
 const root=mkdtempSync(join(tmpdir(),'oficina-guided-')),inputDir=join(root,'fiscal');
 mkdirSync(inputDir);
 const nfeLib=join(root,'ACBrNFe64.dll'),nfeConfig=join(root,'ACBrLibNFe.ini');
 writeFileSync(nfeLib,'fixture');writeFileSync(nfeConfig,'[Principal]\nLogNivel=0\n');
 const provider=createAcbrLibFiscalProvider({nfeLib,nfeConfig,inputDir,
  runner:async()=>({status:'INDETERMINADO'})});
 const snapshot_json=JSON.stringify({originType:'VENDA',lines:[{
  sourceItemId:10,kind:'PECA',description:'Filtro de ar',quantity:1,
  unitPriceCents:10000,subtotalCents:10000,discountCents:discount,totalCents:amount
 }],customer:kind==='NFE'?{name:'Comprador',document:'11222333000181'}:{}});
 const document={id,kind,status:'RASCUNHO',amount_cents:amount,
  snapshot_json,snapshot_hash:createHash('sha256').update(snapshot_json).digest('hex'),
  environment:'HOMOLOGACAO'};
 return {root,inputDir,provider,document};
}

test('revisão guiada NF-e conserva os valores canônicos e cria INI pelo perfil cadastrado',()=>{
 const {root,inputDir,provider,document}=fixture();
 try{
  const profile=provider.saveTaxProfile({issuer,profile:goods});
  const payload={document,issuer,company,customer,
   issuance:{number:'12',series:'1',nature:'Venda de mercadorias'},
   items:[{profileId:profile.id}]};
  assert.equal(provider.saveTaxReview(payload).reviewed,true);
  const stem='NFE-12-'+document.snapshot_hash;
  const review=provider.getTaxReview({document,issuer});
  assert.equal(review.reviewed,true);
  provider.prepare({document,issuer});
  const ini=readFileSync(join(inputDir,stem+'.ini'),'utf8');
  assert.match(ini,/\[Produto001\]/);
  assert.match(ini,/xProd=Filtro de ar/);
  assert.match(ini,/vProd=100\.00/);
  assert.match(ini,/vDesc=10\.00/);
  assert.match(ini,/vNF=90\.00/);
  assert.match(ini,/cNF=\d{8}/);
  assert.throws(()=>provider.saveTaxReview(payload),/já preparado|sobrescrever|preparado/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('NFC-e guiada exige meio de pagamento e bloqueia INI arbitrário na API',()=>{
 const {root,inputDir,provider,document}=fixture({kind:'NFCE',id:16,amount:10000,discount:0});
 try{
  const profile=provider.saveTaxProfile({issuer,profile:goods});
  const payload={document,issuer,company,customer:null,
   issuance:{number:'16',series:'1',nature:'Venda',paymentCode:'01'},
   items:[{profileId:profile.id}]};
  assert.throws(()=>provider.saveTaxReview({document,issuer,sections:{
    Emitente:{CNPJCPF:'99999999999999'}}}),/itens|perfil|canônico|obrigatório/i);
  assert.equal(provider.saveTaxReview(payload).reviewed,true);
  provider.prepare({document,issuer});
  const ini=readFileSync(join(inputDir,'NFCE-16-'+document.snapshot_hash+'.ini'),'utf8');
  assert.match(ini,/mod=65/);
  assert.match(ini,/\[pag001\]/);
  assert.match(ini,/vPag=100\.00/);
  assert.doesNotMatch(ini,/99999999999999/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
