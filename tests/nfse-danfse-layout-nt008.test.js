import {danfseTestLogo} from './fixtures/nfse-logo-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNationalDanfse} from '../src/platform/nfse-national-danfse.js';

const KEY='31062002211222333000181000000000012326111234567890';
const xml='<NFSe><infNFSe Id="NFS'+KEY+'"><nNFSe>123</nNFSe><dhProc>2026-11-05T12:00:00-03:00</dhProc>'+
 '<DPS><infDPS><tpAmb>2</tpAmb><prest><CNPJ>11222333000181</CNPJ><xNome>Prestador</xNome></prest>'+
 '<toma><CPF>12345678909</CPF><xNome>Tomador</xNome></toma><dCompet>2026-11-05</dCompet>'+
 '<nDPS>100</nDPS><serie>1</serie><serv><cServ><xDescServ>Oficina</xDescServ></cServ></serv>'+
 '</infDPS></DPS></infNFSe></NFSe>';

test('cabeçalho normativo contém recursos Arial/MS Sans Serif e logo em XObject local',()=>{
 const pdf=renderNationalDanfse({xml,accessKey:KEY,environment:'HOMOLOGACAO',logoPng:danfseTestLogo});
 const text=pdf.toString('latin1');
 assert.match(text,/\/BaseFont \/Arial/);
 assert.match(text,/\/BaseFont \/MicrosoftSansSerif/);
 assert.match(text,/\/Subtype \/Image/);
 assert.match(text,/\/FontFile2/);
 assert.match(text,/\/FontDescriptor/);
 assert.match(text,/\/ImLogo Do/);
 assert.match(text,/\/MediaBox \[0 0 595\.28 841\.89\]/);
 assert.match(text,/\/Count 1\b/);
});
test('QR tem origem oficial 17,48 x 1,67 cm e nota de homologação vermelha',()=>{
 const pdf=renderNationalDanfse({xml,accessKey:KEY,environment:'HOMOLOGACAO',logoPng:danfseTestLogo});
 const content=pdf.toString('latin1');
 assert.match(content,/495\.5[0-9]* /);
 assert.match(content,/NFS-e SEM VALIDADE JUR/);
 assert.match(content,/0 1 1 0 k/);
 assert.match(content,/ConsultaPublica/);
 assert.ok(content.includes('A autenticidade desta NFS-e pode ser verificada'));
 assert.ok(content.includes('pela leitura deste código QR ou pela consulta'));
 assert.ok(content.includes('da chave de acesso no portal nacional da NFS-e'));
 assert.ok(!content.includes('código Q...'), 'A frase de consulta não pode ser truncada');

});
test('logomarca PNG íntegra é requisito de distribuição, sem substituição silenciosa por texto',()=>{
 assert.throws(()=>renderNationalDanfse({xml,accessKey:KEY,environment:'HOMOLOGACAO',logoPng:Buffer.from('nao-e-png')}),/logomarca|Logo|PNG/i);
});
