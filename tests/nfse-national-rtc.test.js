import test from 'node:test';
import assert from 'node:assert/strict';
import {attachNationalRtc,validateNationalRtc} from '../src/platform/nfse-national-rtc.js';

const id='DPS310620021122233300018100001000000000000025';
const xml='<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">'+
 '<infDPS Id="'+id+'"><tpAmb>1</tpAmb><valores><vServPrest><vServ>100.00</vServ></vServPrest></valores></infDPS></DPS>';
const declarations={finNFSe:'0',cIndOp:'010101',indDest:'0',CST:'000',cClassTrib:'000001'};
test('enriquece DPS antes da assinatura com IBS/CBS 2026 em ordem XSD',()=>{
 const result=attachNationalRtc(xml,declarations);
 assert.match(result,/<IBSCBS><finNFSe>0<\/finNFSe><cIndOp>010101<\/cIndOp><indDest>0<\/indDest>/);
 assert.match(result,/<valores><trib><gIBSCBS><CST>000<\/CST><cClassTrib>000001<\/cClassTrib>/);
 assert.ok(result.indexOf('</valores>')<result.indexOf('<IBSCBS>'));
 assert.ok(result.includes(id));
});
test('não infere tributos, rejeita declarações ausentes ou destinos avançados',()=>{
 for(const bad of [{...declarations,cIndOp:''},{...declarations,indDest:'1'},
  {...declarations,CST:'xx'},{...declarations,cClassTrib:''}])
  assert.throws(()=>validateNationalRtc(bad));
});
test('não altera documento sem infDPS nacional válido',()=>{
 assert.throws(()=>attachNationalRtc('<html></html>',declarations));
});
