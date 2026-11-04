import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresPort,createD1Port,postgresParameters} from '../src/platform/async-sql-ports.js';

test('Postgres parameter conversion preserves ? inside SQL literals, identifiers and comments',()=>{
 const sql="SELECT ? AS id, '?' AS marker, \"?\" AS quoted -- ? comment\nFROM items WHERE item=? /* ? ignored */";
 assert.equal(postgresParameters(sql),'SELECT $1 AS id, \'?\' AS marker, "?" AS quoted -- ? comment\nFROM items WHERE item=$2 /* ? ignored */');
});
test('native PostgreSQL port handles atomic transaction with rollback and no silent SQLite fallback',async()=>{
 const calls=[],pool={
  async query(sql,params){calls.push([sql,params]);return {rows:[{value:12}],rowCount:1};},
  async connect(){return {query:this.query.bind(this),release(){calls.push(['RELEASE',[]]);}};}
 };
 const port=createPostgresPort({pool});
 assert.deepEqual(await port.first('SELECT ? AS value',[12]),{value:12});
 await port.transaction(async tx=>{
  assert.equal((await tx.all('SELECT ? AS value',[12])).length,1);
  assert.equal((await tx.run('UPDATE items SET value=?',[12])).changes,1);
 });
 assert.ok(calls.some(([sql])=>sql==='BEGIN'));
 assert.ok(calls.some(([sql])=>sql==='COMMIT'));
 await assert.rejects(port.transaction(async()=>{throw Error('abort')}),/abort/);
 assert.ok(calls.some(([sql])=>sql==='ROLLBACK'));
});
test('native Cloudflare D1 port uses prepared bindings and atomic batch rather than pretending to support interactive transactions',async()=>{
 const calls=[];
 const binding={prepare(sql){
   const row={sql,bind(...args){calls.push({sql,args});return {
     async first(){return {n:1};},
     async all(){return {results:[{n:1}]};},
     async run(){return {meta:{changes:1}};}
   };}};
   return row;
 },async batch(statements){calls.push({batch:statements.length});return [{results:[{id:1}]},{meta:{changes:1}}];}};
 const port=createD1Port({binding});
 assert.deepEqual(await port.first('SELECT ?',[1]),{n:1});
 assert.equal((await port.all('SELECT ?',[1])).length,1);
 assert.equal((await port.run('UPDATE x SET value=?',[1])).changes,1);
 assert.equal((await port.batch([{sql:'SELECT ?',params:[1]},{sql:'UPDATE x SET value=?',params:[2]}])).length,2);
 await assert.rejects(port.transaction(async()=>{}),/batch/);
 assert.ok(calls.some(c=>c.batch===2));
});

test('Postgres BIGINT and integral NUMERIC results normalize like SQLite without unsafe rounding',async()=>{
 const pool={
  async query(){return{
   rows:[{id:'72000',cents:'6800',huge:'9223372036854775807',name:'6800'}],
   fields:[
    {name:'id',dataTypeID:20},{name:'cents',dataTypeID:1700},
    {name:'huge',dataTypeID:20},{name:'name',dataTypeID:25}
   ],rowCount:1
  }},
  async connect(){return{query:this.query.bind(this),release(){}}}
 };
 const row=await createPostgresPort({pool}).first('SELECT 1');
 assert.equal(row.id,72000);
 assert.equal(row.cents,6800);
 assert.equal(row.huge,'9223372036854775807');
 assert.equal(row.name,'6800','VARCHAR values never converted');
});
