import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWindowsPostgresAlias} from '../src/platform/windows-postgres-alias.js';

test('ASCII Windows data paths never need a mapped drive',async()=>{
 let called=false;
 const alias=await prepareWindowsPostgresAlias('C:\\Users\\RegularUser\\AppData\\Local\\ArtiSys\\Oficina\\postgres',{
  platform:'win32',isDriveAvailable:async()=>{called=true;return true;},
  mount:async()=>{throw Error('should not mount');}
 });
 assert.equal(alias.root,'C:\\Users\\RegularUser\\AppData\\Local\\ArtiSys\\Oficina\\postgres');
 assert.equal(alias.active,false);
 await alias.release();
 assert.equal(called,false);
});

test('accented Windows data path uses an ASCII-only drive alias and releases its own mount',async()=>{
 const operations=[];
 let mounted=false;
 const path='C:\\Users\\Deus e fiél\\AppData\\Local\\ArtiSys\\Oficina\\postgres';
 const alias=await prepareWindowsPostgresAlias(path,{
  platform:'win32',isDriveAvailable:async drive=>drive!=='Z:',
  mount:async(drive,original)=>{mounted=true;operations.push(['mount',drive,original]);},
  unmount:async drive=>operations.push(['unmount',drive]),
  mappedRoot:async()=>mounted?path:null
 });
 assert.equal(alias.active,true);
 assert.equal(alias.root,'Y:\\');
 assert.deepEqual(operations,[['mount','Y:',path]]);
 await alias.release();
 await alias.release();
 assert.deepEqual(operations,[['mount','Y:',path],['unmount','Y:']]);
});

test('no free letter refuses to proceed without touching an existing user cluster',async()=>{
 await assert.rejects(prepareWindowsPostgresAlias('C:\\Users\\João\\AppData\\Local\\postgres',{
  platform:'win32',isDriveAvailable:async()=>false,
  mount:async()=>{throw Error('must never override existing mapping');}
 }),/unidade|disponível|letra/i);
});

test('Linux paths do not call Windows subst even if non-ASCII',async()=>{
 let mounted=false;
 const original='/home/joão/.local/share/oficina/postgres';
 const alias=await prepareWindowsPostgresAlias(original,{
  platform:'linux',mount:async()=>{mounted=true;}
 });
 assert.equal(alias.root,original);
 assert.equal(alias.active,false);
 assert.equal(mounted,false);
});

test('a drive mapping changed externally must never be removed',async()=>{
 const path='C:\\Users\\José\\AppData\\Local\\postgres';
 let unmounted=false;
 let lookups=0;
 const alias=await prepareWindowsPostgresAlias(path,{
  platform:'win32',isDriveAvailable:async()=>true,
  mount:async()=>{},
  unmount:async()=>{unmounted=true;},
  mappedRoot:async()=>++lookups<=12?null:lookups===13?path:'C:\\Unrelated-Drive'
 });
 await alias.release();
 assert.equal(unmounted,false);
});
