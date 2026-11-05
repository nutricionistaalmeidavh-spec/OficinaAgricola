// QA visual reproduzível: dados fictícios, imagem oficial staged e fonte local do runner.
// Sem certificados, credenciais, requisições fiscais ou dados de clientes.
import {mkdirSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {renderNationalDanfse} from '../src/platform/nfse-national-danfse.js';

const key='31062002211222333000181000000000012326111234567890';
const xml='<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS'+key+'">'+
'<nNFSe>123</nNFSe><dhProc>2026-11-05T11:32:10-03:00</dhProc>'+
'<xLocEmi>Uberaba</xLocEmi><cStat>100</cStat><ambGer>1</ambGer>'+
'<DPS><infDPS Id="DPS3106200211222333000181000010000000000000025">'+
'<tpAmb>2</tpAmb><dCompet>2026-11-05</dCompet><dhEmi>2026-11-05T11:30:00-03:00</dhEmi>'+
'<serie>1</serie><nDPS>25</nDPS><tpEmit>1</tpEmit>'+
'<prest><CNPJ>11222333000181</CNPJ><xNome>Prestador Fictício LTDA</xNome>'+
'<email>fiscal@example.invalid</email><end><endNac><cMun>3106200</cMun><CEP>38000000</CEP></endNac>'+
'<xLgr>Rua Principal</xLgr><nro>25</nro><xBairro>Centro</xBairro></end></prest>'+
'<toma><CPF>12345678909</CPF><xNome>Cliente Fictício</xNome></toma>'+
'<serv><locPrest><cLocPrestacao>3106200</cLocPrestacao></locPrest>'+
'<cServ><cTribNac>010101</cTribNac><xDescServ>Manutenção de máquina de serviço com revisão de oficina agrícola e mão de obra especializada.</xDescServ></cServ></serv>'+
'<valores><vServPrest><vServ>150.00</vServ></vServPrest></valores>'+
'</infDPS></DPS><valores><vLiq>150.00</vLiq></valores></infNFSe></NFSe>';
const out=resolve('build/qa-danfse');
mkdirSync(out,{recursive:true});
const pdf=renderNationalDanfse({xml,accessKey:key,environment:'HOMOLOGACAO',issuerCnpj:'11222333000181'});
const file=resolve(out,'danfse-nt008-fixture.pdf');
writeFileSync(file,pdf);
if(pdf.length<1000||pdf.length>6*1024*1024)throw Error('DANFSe QA fora de limite');
const str=pdf.toString('latin1');
for(const marker of ['/FontFile2','/ImLogo Do','/Count 1','/MediaBox [0 0 595.28 841.89]'])
 if(!str.includes(marker))throw Error('QA DANFSe sem recurso obrigatório: '+marker);
if(!existsSync(resolve('build/nfse-national/danfse-logo.png')))
 throw Error('Logo NFS-e oficial não entrou no staging');
try{
 const info=execFileSync('pdfinfo',[file],{encoding:'utf8',timeout:20000});
 if(!/^Pages:\s+1$/m.test(info)||!/Page size:\s+595\.28 x 841\.89 pts/m.test(info))
   throw Error('PDF não é uma página A4 retrato');
 execFileSync('pdftoppm',['-f','1','-l','1','-png','-singlefile',
   '-r','150',file,resolve(out,'danfse-nt008-fixture')],{timeout:30000});
}catch(error){throw Error('Falha na renderização independente do DANFSe: '+error.message)}
if(!existsSync(resolve(out,'danfse-nt008-fixture.png'))||
  statSync(resolve(out,'danfse-nt008-fixture.png')).size<5000)
 throw Error('Prévia DANFSe ausente ou corrompida');
console.info('DANFSe QA: PDF A4 com logo, fontes embutidas e PNG 150 dpi verificados.');
