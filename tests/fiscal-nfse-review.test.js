import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileReviewedNfseIni} from '../src/platform/fiscal-nfse-preparer.js';

const snapshot=JSON.stringify({originType:'OS',originId:7,
  lines:[{kind:'SERVICO',sourceItemId:1,description:'Manutenção preventiva',
    quantity:1,unitPriceCents:20000,subtotalCents:20000,discountCents:0,totalCents:20000}],
  customer:{name:'Cliente',document:'11222333000181'}});
const document={id:19,kind:'NFSE',status:'RASCUNHO',snapshot_json:snapshot,
  snapshot_hash:createHash('sha256').update(snapshot).digest('hex'),
  amount_cents:20000,environment:'HOMOLOGACAO'};
const issuer={cnpj:'11222333000181',uf:'MG',municipalityIbge:'3106200',
  municipalRegistration:'12345',environment:'HOMOLOGACAO'};
function review(){
 return {kind:document.kind,documentId:document.id,snapshotHash:document.snapshot_hash,
   issuerCnpj:issuer.cnpj,environment:issuer.environment,amountCents:document.amount_cents,
   municipalityIbge:'3106200',provider:'ACBR_NFSE',reviewerConfirmed:true,
   sections:{
    IdentificacaoRps:{Numero:'19',Serie:'A',Tipo:'1',DataEmissao:'05/11/2026',
      Competencia:'05/11/2026'},
    Prestador:{CNPJ:issuer.cnpj,InscricaoMunicipal:'12345',CodigoMunicipio:'3106200',
      RazaoSocial:'Oficina Teste'},
    Tomador:{CNPJCPF:'11222333000181',RazaoSocial:'Cliente'},
    Servico:{ItemListaServico:'14.01',CodigoTributacaoMunicipio:'1401',
      CodigoMunicipio:'3106200',MunicipioIncidencia:'3106200',
      Discriminacao:'Manutenção preventiva'},
    Valores:{ValorServicos:'200.00',BaseCalculo:'200.00',Aliquota:'2.00',
      ValorIss:'4.00',ISSRetido:'2',ValorLiquidoNfse:'200.00'}
   }
 };
}
test('NFS-e de serviço gera INI ACBr sem editar arquivo e mantém snapshot canônico',()=>{
 const result=compileReviewedNfseIni({document,issuer,review:review()});
 assert.match(result.ini,/\[IdentificacaoRps\]/);
 assert.match(result.ini,/\[Servico\]/);
 assert.match(result.ini,/ValorServicos=200\.00/);
 assert.match(result.ini,/ValorIss=4\.00/);
 assert.equal(result.manifest.kind,'NFSE');
});
test('município divergente e ISS incorreto bloqueiam revisão',()=>{
 const bad=review();bad.sections.Servico.MunicipioIncidencia='3550308';
 assert.throws(()=>compileReviewedNfseIni({document,issuer,review:bad}),/município|IBGE/i);
 const noTax=review();noTax.sections.Valores.ValorIss='3.00';
 assert.throws(()=>compileReviewedNfseIni({document,issuer,review:noTax}),/ISS|valor/i);
 const noService=review();delete noService.sections.Servico.ItemListaServico;
 assert.throws(()=>compileReviewedNfseIni({document,issuer,review:noService}),/serviço|lista/i);
});
test('NFS-e exige revisão explícita e rejeita injeção INI',()=>{
 const bad=review();bad.reviewerConfirmed=false;
 assert.throws(()=>compileReviewedNfseIni({document,issuer,review:bad}),/revisão|confirm/i);
 const attack=review();attack.sections.Servico.Discriminacao='x\n[Prestador]\nCNPJ=';
 assert.throws(()=>compileReviewedNfseIni({document,issuer,review:attack}),/INI|quebra|inválid/i);
 const noProvider=review();delete noProvider.provider;
 assert.throws(()=>compileReviewedNfseIni({document,issuer,review:noProvider}),/provedor|ACBr/i);
});
