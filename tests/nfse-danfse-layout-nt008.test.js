import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {renderNationalDanfse} from '../src/platform/nfse-national-danfse.js';

// Miniatura PNG sintética apenas para testar a presença da imagem.
// Em builds distribuídos, usar exclusivamente a logomarca horizontal original do portal nacional.
const png=Buffer.concat([
 Buffer.from('89504e470d0a1a0a','hex'),
 Buffer.from('0000000d4948445200000001000000010802000000','hex'),
 Buffer.from('907753de','hex'),
 Buffer.from('0000000c49444154','hex'),
 deflateSync(Buffer.from([0,40,120,80])).subarray(0,12),
 Buffer.from('0000000049454e44ae426082','hex')
]);
const KEY='31062002211222333000181000000000012326111234567890';
const xml='<NFSe><infNFSe Id="NFS'+KEY+'"><nNFSe>123</nNFSe><dhProc>2026-11-05T12:00:00-03:00</dhProc>'+
 '<DPS><infDPS><tpAmb>2</tpAmb><prest><CNPJ>11222333000181</CNPJ><xNome>Prestador</xNome></prest>'+
 '<toma><CPF>12345678909</CPF><xNome>Tomador</xNome></toma><dCompet>2026-11-05</dCompet>'+
 '<nDPS>100</nDPS><serie>1</serie><serv><cServ><xDescServ>Oficina</xDescServ></cServ></serv>'+
 '</infDPS></DPS></infNFSe></NFSe>';

test('cabeçalho normativo contém recursos Arial/MS Sans Serif e logo em XObject local',()=>{
 const pdf=renderNationalDanfse({xml,accessKey:KEY,environment:'HOMOLOGACAO',logoPng:png});
 const text=pdf.toString('latin1');
 assert.match(text,/\/BaseFont \/Arial/);
 assert.match(text,/\/BaseFont \/MicrosoftSansSerif/);
 assert.match(text,/\/Subtype \/Image/);
 assert.match(text,/\/ImLogo Do/);
 assert.match(text,/\/MediaBox \[0 0 595\.28 841\.89\]/);
 assert.match(text,/\/Count 1\b/);
});
test('QR tem origem oficial 17,48 x 1,67 cm e nota de homologação vermelha',()=>{
 const pdf=renderNationalDanfse({xml,accessKey:KEY,environment:'HOMOLOGACAO',logoPng:png});
 const content=pdf.toString('latin1');
 assert.match(content,/495\.5[0-9]* /);
 assert.match(content,/NFS-e SEM VALIDADE JUR/);
 assert.match(content,/1 0 0 rg/);
 assert.match(content,/ConsultaPublica/);
});
test('logomarca oficial é requisito de distribuição, sem substituição silenciosa por texto',()=>{
 assert.throws(()=>renderNationalDanfse({xml,accessKey:KEY,environment:'HOMOLOGACAO'}),/logomarca|Logo|PNG/i);
});
