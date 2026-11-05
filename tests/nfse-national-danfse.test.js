import {danfseTestLogo} from './fixtures/nfse-logo-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNationalDanfse} from '../src/platform/nfse-national-danfse.js';

const key='31062002211222333000181000000000012326111234567890';
const xml='<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS'+key+'">'+
'<nNFSe>123</nNFSe><dhProc>2026-11-05T11:32:10-03:00</dhProc>'+
'<xLocEmi>Uberaba</xLocEmi><cStat>100</cStat><ambGer>1</ambGer>'+
'<DPS><infDPS Id="DPS3106200211222333000181000010000000000000025">'+
'<tpAmb>2</tpAmb><dCompet>2026-11-05</dCompet><dhEmi>2026-11-05T11:30:00-03:00</dhEmi>'+
'<serie>1</serie><nDPS>25</nDPS><tpEmit>1</tpEmit>'+
'<prest><CNPJ>11222333000181</CNPJ><xNome>Prestador &amp; Serviços</xNome>'+
'<email>financeiro@prestador.local</email><end><endNac><cMun>3106200</cMun><CEP>38000000</CEP></endNac>'+
'<xLgr>Rua Principal</xLgr><nro>25</nro><xBairro>Centro</xBairro></end></prest>'+
'<toma><CPF>12345678909</CPF><xNome>Cliente Teste</xNome></toma>'+
'<serv><locPrest><cLocPrestacao>3106200</cLocPrestacao></locPrest>'+
'<cServ><cTribNac>010101</cTribNac><xDescServ>Reparo mecânico</xDescServ></cServ></serv>'+
'<valores><vServPrest><vServ>150.00</vServ></vServPrest></valores>'+
'</infDPS></DPS><valores><vLiq>150.00</vLiq></valores></infNFSe></NFSe>';

test('DANFSe gerado localmente em A4 retrato, com QR oficial e aviso de homologação',()=>{
 const pdf=renderNationalDanfse({xml,accessKey:key,environment:'HOMOLOGACAO',logoPng:danfseTestLogo});
 assert.ok(Buffer.isBuffer(pdf));
 const text=pdf.toString('latin1');
 assert.match(text,/^%PDF-1\./);
 assert.match(text,/\/MediaBox \[0 0 595\.28 841\.89\]/);
 assert.match(text,/\/Count 1\b/);
 assert.match(text,/DANFSe v2\.0/);
 assert.match(text,/SEM VALIDADE JUR.DICA/);
 assert.match(text,/31062002211222333000181000000000012326111234567890/);
 assert.match(text,/Reparo mec/);
 assert.match(text,/www\.nfse\.gov\.br\/ConsultaPublica/);
 assert.ok(pdf.length<6*1024*1024);
});
test('DANFSe rejeita XML não oficial, chave ou ambiente divergentes',()=>{
 assert.throws(()=>renderNationalDanfse({xml:'<html></html>',accessKey:key,environment:'HOMOLOGACAO',logoPng:danfseTestLogo}),/NFSe|XML/i);
 assert.throws(()=>renderNationalDanfse({xml,accessKey:'1'.repeat(50),environment:'HOMOLOGACAO',logoPng:danfseTestLogo}),/chave|Id/i);
 assert.throws(()=>renderNationalDanfse({xml,accessKey:key,environment:'PRODUCAO',logoPng:danfseTestLogo}),/ambiente|tpAmb/i);
 assert.throws(()=>renderNationalDanfse({xml:'<!DOCTYPE x>'+xml,accessKey:key,environment:'HOMOLOGACAO',logoPng:danfseTestLogo}),/DOCTYPE|XML/i);
});
