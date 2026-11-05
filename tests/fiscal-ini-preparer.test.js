import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileReviewedFiscalIni} from '../src/platform/fiscal-ini-preparer.js';

const snapshot=JSON.stringify({originType:'OS',originId:3,lines:[
  {sourceItemId:9,kind:'PECA',description:'Filtro de óleo',quantity:2,
   unitPriceCents:4500,subtotalCents:9000,discountCents:1000,totalCents:8000}
],customer:{name:'Comprador',document:'11222333000181'}});
const document={id:4,kind:'NFE',snapshot_json:snapshot,
  snapshot_hash:createHash('sha256').update(snapshot).digest('hex'),
  amount_cents:8000,environment:'HOMOLOGACAO'};
const issuer={cnpj:'11222333000181',environment:'HOMOLOGACAO'};
function reviewed(){
 return {kind:'NFE',documentId:4,snapshotHash:document.snapshot_hash,
   issuerCnpj:issuer.cnpj,environment:'HOMOLOGACAO',amountCents:8000,
   sections:{
     infNFe:{versao:'4.00'},
     Identificacao:{mod:'55',serie:'1',nNF:'123',tpAmb:'2',natOp:'Venda'},
     Emitente:{CNPJCPF:issuer.cnpj,IE:'123',xNome:'Oficina de Teste'},
     Destinatario:{CNPJCPF:'11222333000181',xNome:'Comprador'},
     Produto001:{NCM:'84212300',CFOP:'5102',Unidade:'UN'},
     ICMS001:{CSOSN:'102',orig:'0'},PIS001:{CST:'49'},COFINS001:{CST:'49'},
     Total:{ValorProduto:'90.00',ValorDesconto:'10.00',ValorNota:'80.00'}
   }};
}
test('reviewed fiscal document is compiled from immutable financial snapshot',()=>{
 const result=compileReviewedFiscalIni({document,issuer,review:reviewed()});
 assert.match(result.ini,/\[Produto001\]/);
 assert.match(result.ini,/qCom=2/);
 assert.match(result.ini,/vProd=90\.00/);
 assert.match(result.ini,/vDesc=10\.00/);
 assert.match(result.ini,/xProd=Filtro de óleo/);
 assert.match(result.ini,/cProd=9/);
 assert.match(result.ini,/vUnCom=45\\.00/);
 assert.match(result.ini,/vNF=80\\.00/);
 assert.doesNotMatch(result.ini,/ValorProduto=|ValorNota=|ValorTotal=/);
 assert.deepEqual(result.manifest,{kind:'NFE',documentId:4,
  snapshotHash:document.snapshot_hash,amountCents:8000,
  issuerCnpj:issuer.cnpj,environment:'HOMOLOGACAO'});
});
test('reviewed fiscal data fails closed on amount, XML injection and taxation gaps',()=>{
 const bad=reviewed();bad.amountCents=100;
 assert.throws(()=>compileReviewedFiscalIni({document,issuer,review:bad}),/manifesto|valor|diverg|correspond/i);
 const missing=reviewed();delete missing.sections.ICMS001;
 assert.throws(()=>compileReviewedFiscalIni({document,issuer,review:missing}),/ICMS|tribut/i);
 const injection=reviewed();injection.sections.Produto001.NCM='84212300\n[Emitente]';
 assert.throws(()=>compileReviewedFiscalIni({document,issuer,review:injection}),/NCM|CFOP|INI|inválid|linha/i);
});

test('official ACBr NFe fields come from immutable item snapshot',()=>{
 const data=reviewed();
 data.sections.Produto001.xProd='Produto indevido';
 data.sections.Produto001.vProd='1.00';
 const {ini}=compileReviewedFiscalIni({document,issuer,review:data});
 assert.match(ini,/xProd=Filtro de óleo/);
 assert.match(ini,/vProd=90\\.00/);
 assert.doesNotMatch(ini,/Produto indevido/);
});
