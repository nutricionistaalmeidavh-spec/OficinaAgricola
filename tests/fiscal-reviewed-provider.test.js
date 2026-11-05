import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAcbrLibFiscalProvider} from '../src/platform/acbrlib-fiscal-provider.js';

test('fiscal tax review builds real ACBr INI from guided data and frozen commercial values',()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-tax-')),inputDir=join(root,'fiscal');
 mkdirSync(inputDir);
 try{
  const nfeLib=join(root,'ACBrNFe64.dll'),nfeConfig=join(root,'ACBrLibNFe.ini');
  writeFileSync(nfeLib,'fixture');writeFileSync(nfeConfig,'[Principal]\nLogNivel=0\n');
  const provider=createAcbrLibFiscalProvider({
    nfeLib,nfeConfig,inputDir,runner:async()=>({status:'INDETERMINADO'})
  });
  const snapshot_json=JSON.stringify({originType:'OS',lines:[{
    sourceItemId:10,kind:'PECA',description:'Filtro de ar',quantity:1,
    unitPriceCents:10000,subtotalCents:10000,discountCents:1000,totalCents:9000
  }],customer:{name:'Cliente',document:'11222333000181'}});
  const document={id:12,kind:'NFE',status:'RASCUNHO',amount_cents:9000,
    snapshot_json,snapshot_hash:createHash('sha256').update(snapshot_json).digest('hex'),
    environment:'HOMOLOGACAO'};
  const issuer={cnpj:'11222333000181',uf:'SP',municipalityIbge:'3550308',environment:'HOMOLOGACAO'};
  const sections={
    infNFe:{versao:'4.00'},
    Identificacao:{mod:'55',cUF:'35',cMunFG:'3550308',serie:'1',nNF:'12',tpAmb:'2',natOp:'Venda'},
    Emitente:{CNPJCPF:issuer.cnpj,IE:'123',xNome:'Oficina QA'},
    Destinatario:{CNPJCPF:'11222333000181',xNome:'Cliente'},
    Produto001:{NCM:'84212300',CFOP:'5102',uCom:'UN',vProd:'0.01'},
    ICMS001:{CSOSN:'102',orig:'0'},PIS001:{CST:'49'},COFINS001:{CST:'49'},
    Total:{vProd:'100.00',vDesc:'10.00',vNF:'90.00'}
  };
  assert.equal(provider.saveTaxReview({document,issuer,sections}).reviewed,true);
  const stem='NFE-12-'+document.snapshot_hash;
  const review=JSON.parse(readFileSync(join(inputDir,stem+'.review.json'),'utf8'));
  assert.match(review.sections.Identificacao.cNF,/^\d{8}$/);
  provider.prepare({document,issuer});
  assert.equal(existsSync(join(inputDir,stem+'.ini')),true);
  const ini=readFileSync(join(inputDir,stem+'.ini'),'utf8');
  assert.match(ini,/\[Produto001\]/);
  assert.match(ini,/xProd=Filtro de ar/);
  assert.match(ini,/vProd=100\.00/);
  assert.match(ini,/vDesc=10\.00/);
  assert.match(ini,/vNF=90\.00/);
  assert.match(ini,/cNF=\d{8}/);
  assert.match(ini,/dhEmi=\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/);
  assert.throws(()=>provider.saveTaxReview({document,issuer,sections}),/já preparado/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('revisão NFC-e guiada salva INI com pagamento explícito, sem alterar valores comerciais',()=>{
 const root=mkdtempSync(join(tmpdir(),'oficina-nfce-review-')),inputDir=join(root,'fiscal');
 mkdirSync(inputDir);
 try{
  const nfeLib=join(root,'ACBrNFe64.dll'),nfeConfig=join(root,'ACBrLibNFe.ini');
  writeFileSync(nfeLib,'fixture');writeFileSync(nfeConfig,'[Principal]\nLogNivel=0\n');
  const provider=createAcbrLibFiscalProvider({nfeLib,nfeConfig,inputDir,runner:async()=>({status:'INDETERMINADO'})});
  const snapshot_json=JSON.stringify({originType:'VENDA',lines:[{
   sourceItemId:5,kind:'PECA',description:'Óleo',quantity:1,
   unitPriceCents:9000,subtotalCents:9000,discountCents:0,totalCents:9000
  }],customer:{}});
  const document={id:16,kind:'NFCE',status:'RASCUNHO',amount_cents:9000,
    snapshot_json,snapshot_hash:createHash('sha256').update(snapshot_json).digest('hex'),
    environment:'HOMOLOGACAO'};
  const issuer={cnpj:'11222333000181',uf:'SP',municipalityIbge:'3550308',environment:'HOMOLOGACAO'};
  const sections={
   infNFe:{versao:'4.00'},
   Identificacao:{mod:'65',cUF:'35',cMunFG:'3550308',serie:'1',nNF:'16',tpAmb:'2',
    natOp:'Venda',idDest:'1',indFinal:'1',indPres:'1',tpEmis:'1'},
   Emitente:{CNPJCPF:issuer.cnpj,IE:'123',xNome:'Oficina QA'},
   Produto001:{NCM:'27101932',CFOP:'5102',uCom:'UN'},
   ICMS001:{CSOSN:'102',orig:'0'},PIS001:{CST:'49'},COFINS001:{CST:'49'},
   pag001:{tPag:'01',vPag:'90.00'},Total:{vProd:'90.00',vDesc:'0.00',vNF:'90.00'}
  };
  assert.equal(provider.saveTaxReview({document,issuer,sections}).reviewed,true);
  provider.prepare({document,issuer});
  const ini=readFileSync(join(inputDir,'NFCE-16-'+document.snapshot_hash+'.ini'),'utf8');
  assert.match(ini,/mod=65/);
  assert.match(ini,/\[pag001\]/);
  assert.match(ini,/vPag=90\.00/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
