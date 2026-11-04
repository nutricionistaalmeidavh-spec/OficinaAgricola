// Async ports for the incremental migration away from node:sqlite's
// synchronous API. This file does not silently switch the legacy runtime.
// PostgreSQL uses an injected open-source pg Pool; D1 uses a native Worker
// D1Database binding. Both are opt-in, never billed implicitly.
export function postgresParameters(sql){
  let output='',index=0,state='normal',tag='';
  for(let i=0;i<sql.length;i++){
    const a=sql[i],b=sql[i+1];
    if(state==='normal'){
      if(a==="'"||a==='"'){state=a==="'"?'single':'double';output+=a;continue;}
      if(a==='-'&&b==='-'){state='line';output+='--';i++;continue;}
      if(a==='/'&&b==='*'){state='block';output+='/*';i++;continue;}
      if(a==='$'){
        const match=sql.slice(i).match(/^(\$[A-Za-z_0-9]*\$)/);
        if(match){tag=match[1];state='dollar';output+=tag;i+=tag.length-1;continue;}
      }
      if(a==='?'){output+='$'+(++index);continue;}
      output+=a;continue;
    }
    if(state==='single'||state==='double'){
      output+=a;
      if(a==='\\'&&b){output+=b;i++;continue;}
      if(a===(state==='single'?"'":'"')){
        if(b===a){output+=b;i++;}
        else state='normal';
      }
      continue;
    }
    if(state==='line'){
      output+=a;if(a==='\n')state='normal';continue;
    }
    if(state==='block'){
      output+=a;if(a==='*'&&b==='/'){output+='/';i++;state='normal';}continue;
    }
    if(state==='dollar'){
      if(sql.startsWith(tag,i)){output+=tag;i+=tag.length-1;state='normal';}
      else output+=a;
    }
  }
  if(state==='block'||state==='single'||state==='double'||state==='dollar')
    throw Error('SQL incompleto; identificador literal não terminado');
  return output;
}
// pg returns BIGINT / integral NUMERIC as strings by default.
// Convert only provably safe integer values; never round a 64-bit ID.
function normalizedPgRows(result){
 const rows=result?.rows||[],fields=result?.fields||[];
 const numeric=new Set(fields.filter(f=>f.dataTypeID===20||f.dataTypeID===1700).map(f=>f.name));
 if(!numeric.size)return rows;
 const lower=BigInt(Number.MIN_SAFE_INTEGER),upper=BigInt(Number.MAX_SAFE_INTEGER);
 return rows.map(row=>{
   const next={...row};
   for(const name of numeric){
     const value=next[name];
     if(typeof value==='string'&&/^-?\\d+$/.test(value)){
       const exact=BigInt(value);
       if(exact>=lower&&exact<=upper)next[name]=Number(exact);
     }
   }
   return next;
 });
}
function postgresQuery(client){
  if(!client||typeof client.query!=='function')throw Error('PostgreSQL requer pool do driver pg open source');
  const query=(sql,params=[])=>{
    if(!Array.isArray(params))throw Error('Parâmetros SQL inválidos');
    return client.query(postgresParameters(sql),params);
  };
  return Object.freeze({
    engine:'postgres',
    async all(sql,params=[]){return normalizedPgRows(await query(sql,params));},
    async first(sql,params=[]){return normalizedPgRows(await query(sql,params))[0]??null;},
    async run(sql,params=[]){
      const r=await query(sql,params);
      return {changes:Number(r.rowCount??0),rows:normalizedPgRows(r)};
    }
  });
}
export function createPostgresPort({pool}={}){
  const base=postgresQuery(pool);
  if(typeof pool.connect!=='function')throw Error('PostgreSQL requer pool.connect para transações');
  return Object.freeze({
    ...base,
    async transaction(fn){
      if(typeof fn!=='function')throw Error('Callback transacional obrigatório');
      const connection=await pool.connect();
      const tx=postgresQuery(connection);
      try{
        await connection.query('BEGIN');
        const result=await fn(tx);
        await connection.query('COMMIT');
        return result;
      }catch(error){
        try{await connection.query('ROLLBACK');}catch{}
        throw error;
      }finally{connection.release();}
    }
  });
}
export function createD1Port({binding}={}){
  if(!binding?.prepare||!binding?.batch)throw Error('D1 requer binding nativo do Worker');
  const prepared=(sql,params=[])=>{
    if(!Array.isArray(params))throw Error('Parâmetros SQL inválidos');
    return binding.prepare(sql).bind(...params);
  };
  return Object.freeze({
    engine:'d1',
    async all(sql,params=[]){return (await prepared(sql,params).all()).results||[];},
    async first(sql,params=[]){return (await prepared(sql,params).first())??null;},
    async run(sql,params=[]){
      const result=await prepared(sql,params).run();
      return {changes:Number(result.meta?.changes??0),result};
    },
    async batch(statements){
      if(!Array.isArray(statements)||!statements.length)throw Error('Lote D1 vazio');
      return binding.batch(statements.map(({sql,params=[]})=>prepared(sql,params)));
    },
    async transaction(){
      throw Error('D1 não suporta transação interativa: use batch atômico; reestruture o serviço antes de migrar');
    }
  });
}
