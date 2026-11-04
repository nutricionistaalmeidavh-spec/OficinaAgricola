import {createPostgresPort,createD1Port} from './async-sql-ports.js';

// Single promise-based SQL boundary for business services and the global registry.
// D1 batches are atomic but do NOT implement interactive PostgreSQL transactions.
export const COMMON_DATA_CONTRACT_METHODS=Object.freeze([
 'all','first','run','batch','transaction'
]);
export function assertCommonDataContract(port,{interactiveTransactions=false}={}){
 if(!port||!['sqlite','postgres','d1'].includes(port.engine))
   throw Error('Engine SQL não suportado no contrato comum');
 if(typeof interactiveTransactions!=='boolean')
   throw Error('interactiveTransactions exige opção booleana');
 for(const name of COMMON_DATA_CONTRACT_METHODS)
   if(typeof port[name]!=='function')
     throw Error('Contrato SQL incompleto: método '+name+' obrigatório');
 if(interactiveTransactions&&port.engine==='d1')
   throw Error('D1 não implementa transações interativas; use batch atômico');
 return port;
}

// The application-facing contract is promise-based across ALL engines.
// A local Windows/offline customer keeps the existing SQLite DatabaseSync
// file and migrations; opting into PG/D1 never reconfigures local clients.
export function createCommonDataAdapter({engine='sqlite',db,pool,binding}={}){
 if(engine==='postgres'){
   const port=createPostgresPort({pool});
   return Object.freeze({...port,async batch(statements){
     if(!Array.isArray(statements)||!statements.length)
       throw Error('Lote PostgreSQL vazio');
     return port.transaction(async tx=>{
       const results=[];
       for(const command of statements){
         if(typeof command?.sql!=='string'||!Array.isArray(command.params??[]))
           throw Error('Comando SQL inválido');
         results.push(await tx.run(command.sql,command.params??[]));
       }
       return results;
     });
   }});
 }
 if(engine==='d1')return createD1Port({binding});
 if(engine!=='sqlite')throw Error('Engine SQL não suportado; escolha sqlite, postgres ou d1');
 if(!db||typeof db.prepare!=='function'||typeof db.exec!=='function')
   throw Error('SQLite local exige DatabaseSync aberto');
 let queue=Promise.resolve();
 const exclusive=async fn=>{
   const previous=queue;
   let unlock;
   queue=new Promise(resolve=>{unlock=resolve;});
   await previous;
   try{return await fn();}
   finally{unlock();}
 };
 const statement=(sql,params=[])=>{
   if(typeof sql!=='string'||!Array.isArray(params))
     throw Error('SQL ou parâmetros inválidos');
   return db.prepare(sql);
 };
 const direct=Object.freeze({
   engine:'sqlite',
   async all(sql,params=[]){return statement(sql,params).all(...params);},
   async first(sql,params=[]){return statement(sql,params).get(...params)??null;},
   async run(sql,params=[]){
     const result=statement(sql,params).run(...params);
     return {changes:Number(result.changes),lastInsertRowid:Number(result.lastInsertRowid)};
   }
 });
 const transaction=fn=>exclusive(async()=>{
   if(typeof fn!=='function')throw Error('Callback transacional obrigatório');
   db.exec('BEGIN IMMEDIATE');
   try{
     const result=await fn(direct);
     db.exec('COMMIT');
     return result;
   }catch(error){
     try{db.exec('ROLLBACK');}catch{}
     throw error;
   }
 });
 return Object.freeze({
   engine:'sqlite',
   all:(sql,params=[])=>exclusive(()=>direct.all(sql,params)),
   first:(sql,params=[])=>exclusive(()=>direct.first(sql,params)),
   run:(sql,params=[])=>exclusive(()=>direct.run(sql,params)),
   transaction,
   async batch(commands){
     if(!Array.isArray(commands)||!commands.length)
       throw Error('Lote SQLite vazio');
     return transaction(async tx=>{
       const results=[];
       for(const command of commands){
         if(typeof command?.sql!=='string'||!Array.isArray(command.params??[]))
           throw Error('Comando SQL inválido');
         results.push(await tx.run(command.sql,command.params??[]));
       }
       return results;
     });
   }
 });
}
