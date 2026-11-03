import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createDiagnosticScan} from '../src/services/automotive.js';
import {decodePid,decodeDtcMode,decodeReadiness,parseDiagnosticCapture,listDiagnosticAdapters} from '../src/services/diagnostics.js';
import {renderDiagnosticPdf} from '../src/documents.js';

test('registry lists hardware drivers and visibly unsupported J2534, no paid core',()=>{
 const list=listDiagnosticAdapters();
 assert.equal(list.find(x=>x.id==='ELM327_SERIAL').available,true);
 assert.equal(list.find(x=>x.id==='OBDLINK_STN_SERIAL').available,true);
 assert.equal(list.find(x=>x.id==='J2534').available,false);
 assert.equal(list.find(x=>x.id==='SIMULATOR').source,'SIMULATED');
});

test('standardized sensor modes decode canonical physical units',()=>{
 assert.deepEqual(decodePid('010C','41 0C 1A F8'),{pid:'010C',name:'RPM',unit:'rpm',value:1726});
 assert.equal(decodePid('0105','41 05 7B').value,83);
 assert.equal(decodePid('010D','41 0D 64').value,100);
 assert.equal(decodePid('0104','41 04 80').value,50.2);
 assert.throws(()=>decodePid('010C','NO DATA'),/indisponível|inválida/i);
 assert.throws(()=>decodePid('010C','41 0C 1A'),/truncada|inválida/i);
});

test('DTCs armazenados, pendentes e permanentes têm modos distintos',()=>{
 assert.deepEqual(decodeDtcMode('03','43 01 33 00 00'),['P0133']);
 assert.deepEqual(decodeDtcMode('07','47 01 33 00 00'),['P0133']);
 assert.deepEqual(decodeDtcMode('0A','4A 00 00'),[]);
 assert.throws(()=>decodeDtcMode('07','43 01 33'),/inválida/);
});

test('captura separa leituras reais e série temporal derivada de respostas cruas',()=>{
 const capture=parseDiagnosticCapture({
   adapterId:'ELM327_SERIAL',source:'REAL',protocol:'ISO 15765-4 CAN',
   responses:{'03':'43 01 33 00 00','07':'47 00 00','010C':'41 0C 1A F8','0105':'41 05 7B'},
   samples:[{timeMs:0,responses:{'010C':'41 0C 1A F8'}},{timeMs:1500,responses:{'010C':'41 0C 20 00'}}]
 });
 assert.deepEqual(capture.storedCodes,['P0133']);
 assert.deepEqual(capture.pendingCodes,[]);
 assert.equal(capture.readings['010C'].value,1726);
 assert.equal(capture.samples[1].values['010C'],2048);
 assert.equal(capture.adapterId,'ELM327_SERIAL');
 assert.throws(()=>parseDiagnosticCapture({adapterId:'J2534',responses:{'03':'43 00 00'}}),/indisponível/);
 assert.throws(()=>parseDiagnosticCapture({adapterId:'SIMULATOR',source:'REAL',responses:{'03':'43 00 00'}}),/simulad/i);
});

test('laudo PDF e registros históricos preservam origem e vínculo do veículo',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try{
  const customer=createCustomer(db,{name:'Frota de testes'});
  const car=createMachine(db,{customerId:customer.id,type:'Carro',brand:'VW',model:'Gol',odometerKm:48000});
  const scan=createDiagnosticScan(db,car.id,{
   adapterId:'SIMULATOR',source:'SIMULATED',notes:'Teste offline, não é resultado real.',
   protocol:'Simulação local',responses:{'03':'43 01 33 00 00','010C':'41 0C 1A F8'}
  });
  assert.equal(scan.source,'SIMULATED');
  assert.equal(JSON.parse(scan.codes_json)[0],'P0133');
  assert.equal(JSON.parse(scan.details_json).readings['010C'].value,1726);
  const pdf=renderDiagnosticPdf(db,car.id,scan.id);
  assert.equal(pdf.subarray(0,8).toString('latin1'),'%PDF-1.4');
  assert.match(pdf.toString('latin1'),/SIMULAD|P0133/);
  assert.throws(()=>renderDiagnosticPdf(db,car.id+1,scan.id),/não encontrad/i);
 }finally{db.close()}
});

test('modo 01 PID 01 identifica MIL e quantidade de falhas com indicação de disponibilidade',()=>{
 const ready=decodeReadiness('41 01 82 07 65 65');
 assert.equal(ready.mil,true);
 assert.equal(ready.storedDtcCount,2);
 assert.deepEqual(ready.monitorBytes,[7,101,101]);
 assert.throws(()=>decodeReadiness('41 01 80 00'),/truncada/);
});
