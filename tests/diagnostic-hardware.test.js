import test from 'node:test';
import assert from 'node:assert/strict';
import {listDiagnosticAdapters,parseDiagnosticCapture,decodeJ1939Frame} from '../src/services/diagnostics.js';
import {parseHardwareOptions} from '../src/platform/diagnostic-hardware.js';
test('J2534/J1939 enabled as real hardware drivers, never silently simulated',()=>{
 const a=listDiagnosticAdapters();
 assert.equal(a.find(x=>x.id==='J2534').available,true);
 assert.equal(a.find(x=>x.id==='J1939').available,true);
 assert.equal(a.find(x=>x.id==='J2534').source,'REAL');
 assert.equal(a.find(x=>x.id==='J1939').source,'REAL');
 assert.throws(()=>parseDiagnosticCapture({adapterId:'J1939',source:'SIMULATED',j1939:{frames:[]}}),/simulad|fonte|origem/i);
});
test('PGN 61444 decodes J1939 engine rpm using SPN190 resolution',()=>{
 const result=decodeJ1939Frame({id:0x0CF00400,data:'FF FF FF 40 1F FF FF FF'});
 assert.equal(result.pgn,61444);
 assert.equal(result.sourceAddress,0);
 assert.equal(result.readings.engineRpm.value,1000);
 assert.equal(result.readings.engineRpm.unit,'rpm');
});
test('PGN 65262 decodes coolant with 40-degree offset and skips not-available FF',()=>{
 assert.equal(decodeJ1939Frame({id:0x18FEEE00,data:'78 FF FF FF FF FF FF FF'}).readings.coolantTemp.value,80);
 assert.deepEqual(decodeJ1939Frame({id:0x18FEEE00,data:'FF FF FF FF FF FF FF FF'}).readings,{});
});
test('PGN 65226 DM1 decodes SPN/FMI/occurrence and source address',()=>{
 const result=decodeJ1939Frame({id:0x18FECA17,data:'00 00 BE 00 05 02 FF FF'});
 assert.equal(result.pgn,65226);
 assert.deepEqual(result.dtcs,[{spn:190,fmi:5,occurrences:2,sourceAddress:23}]);
});
test('J1939 capture can persist canonical machine/OS history with non-OBD code',()=>{
 const capture=parseDiagnosticCapture({adapterId:'J1939',source:'REAL',protocol:'SAE J1939 CAN, passivo',
  j1939:{frames:[{id:0x0CF00400,data:'FF FF FF 40 1F FF FF FF'},{id:0x18FECA17,data:'00 00 BE 00 05 02 FF FF'}]}});
 assert.equal(capture.adapterId,'J1939');
 assert.deepEqual(capture.storedCodes,['SPN190-FMI5']);
 assert.equal(capture.readings.engineRpm.value,1000);
 assert.equal(capture.j1939.frameCount,2);
 assert.throws(()=>parseDiagnosticCapture({adapterId:'J1939',source:'REAL',j1939:{frames:[{id:1,data:'FFFFFFFFFFFF'}]}}),/8 bytes|dados|quadro|inválid/i);
});
test('hardware capture options enforce listen-only J1939 and fixed J2534 requests',()=>{
 assert.deepEqual(parseHardwareOptions({adapterId:'J1939',interface:'pcan',channel:'PCAN_USBBUS1',durationSeconds:5}).mode,'passive');
 assert.throws(()=>parseHardwareOptions({adapterId:'J1939',interface:'virtual',channel:'vcan0'}),/não permitido|inválid/i);
 assert.throws(()=>parseHardwareOptions({adapterId:'J2534',driverKey:'../../evil'}),/inválid/i);
 assert.throws(()=>parseHardwareOptions({adapterId:'J1939',interface:'socketcan',channel:'can0',durationSeconds:90}),/duração|intervalo/i);
});
