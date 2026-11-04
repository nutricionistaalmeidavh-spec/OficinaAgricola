import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBankStatementFile} from '../src/platform/billing-file-import.js';

test('importa CSV bancário BR com aspas, sinal, datas e IDs preservados',()=>{
 const text='Data;Valor;Descrição;ID\n04/11/2026;1.234,56;"PIX; OS 45";txn-1\n05/11/2026;-9,90;Tarifa;txn-2';
 const rows=parseBankStatementFile({format:'CSV',content:text,bankAccount:'conta-1'});
 assert.deepEqual(rows.map(x=>({date:x.bookedAt,value:x.amountCents,id:x.externalId})),[
  {date:'2026-11-04',value:123456,id:'txn-1'},
  {date:'2026-11-05',value:-990,id:'txn-2'}
 ]);
 assert.equal(rows[0].description,'PIX; OS 45');
});
test('importa OFX SGML brasileiro sem fechamento de tags de campo',()=>{
 const text='OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261104120000[-3:BRT]<TRNAMT>123.45<FITID>ofx-1<MEMO>Recebido</STMTTRN><STMTTRN><DTPOSTED>20261105<TRNAMT>-5.00<FITID>ofx-2<NAME>Taxa</STMTTRN></BANKTRANLIST></OFX>';
 const rows=parseBankStatementFile({format:'OFX',content:text,bankAccount:'conta-1'});
 assert.deepEqual(rows.map(x=>x.amountCents),[12345,-500]);
 assert.equal(rows[1].bookedAt,'2026-11-05');
});
test('rejeita montante impreciso, arquivo grande e transação OFX sem FITID',()=>{
 assert.throws(()=>parseBankStatementFile({format:'CSV',bankAccount:'a',content:'Data;Valor\n04/11/2026;1,234'}),/valor|decimais/i);
 assert.throws(()=>parseBankStatementFile({format:'CSV',bankAccount:'a',content:'x'.repeat(1024*1024+1)}),/limite/i);
 assert.throws(()=>parseBankStatementFile({format:'OFX',bankAccount:'a',content:'<STMTTRN><DTPOSTED>20261104<TRNAMT>1.00</STMTTRN>'}),/FITID/i);
});
test('CSV sem ID possui chave determinística por ocorrência, reimportável e sem colapsar duplicadas',()=>{
 const content='Data,Valor,Descrição\n2026-11-04,10.00,Pix\n2026-11-04,10.00,Pix';
 const rows=parseBankStatementFile({format:'CSV',content,bankAccount:'a'});
 assert.equal(rows.length,2);
 assert.notEqual(rows[0].externalId,rows[1].externalId);
 assert.deepEqual(rows,parseBankStatementFile({format:'CSV',content,bankAccount:'a'}));
});
