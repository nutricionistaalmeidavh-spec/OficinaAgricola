import {createHash} from 'node:crypto';

export function boundedPageSize(value,defaultSize=50,max=100){
  const n=value==null||value===''?defaultSize:Number(value);
  if(!Number.isSafeInteger(n)||n<1)throw new Error('Limite da página inválido');
  return Math.min(n,max);
}
function fingerprint(scope,params){
  return createHash('sha256').update(JSON.stringify([scope,params])).digest('hex').slice(0,16);
}
function readCursor(cursor,signature){
  if(cursor==null||cursor==='')return null;
  if(typeof cursor!=='string'||cursor.length>512||!/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new Error('Cursor inválido');
  try{
    const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
    if(value.v!==1||value.s!==signature||!Number.isSafeInteger(value.i)||value.i<1||
      !['string','number'].includes(typeof value.k)||
      (typeof value.k==='number'&&!Number.isFinite(value.k))||
      (typeof value.k==='string'&&value.k.length>512))
      throw new Error('Cursor inválido');
    return value;
  }catch{throw new Error('Cursor inválido');}
}
function makeCursor(row,signature){
  return Buffer.from(JSON.stringify({v:1,s:signature,k:row.__page_sort,i:row.id})).toString('base64url');
}
export function selectPage(db,{
  from,select,where=[],args=[],sort,id='t.id',direction='DESC',
  cursor=null,limit=50,scope='',maxLimit=100
}){
  if(!['ASC','DESC'].includes(direction))throw new Error('Ordenação inválida');
  const size=boundedPageSize(limit,50,maxLimit);
  const signature=fingerprint(scope,[where,args,direction]);
  const token=readCursor(cursor,signature);
  const filters=[...where],values=[...args];
  const baseWhere=filters.length?' WHERE '+filters.join(' AND '):'';
  const total=Number(db.prepare('SELECT COUNT(*) n '+from+baseWhere).get(...args).n);
  if(token){
    const comparison=direction==='DESC'?'<':'>';
    filters.push('('+sort+' '+comparison+' ? OR ('+sort+' = ? AND '+id+' '+comparison+' ?))');
    values.push(token.k,token.k,token.i);
  }
  const condition=filters.length?' WHERE '+filters.join(' AND '):'';
  const rows=db.prepare('SELECT '+select+', '+sort+' AS __page_sort '+from+condition+
    ' ORDER BY '+sort+' '+direction+', '+id+' '+direction+' LIMIT ?').all(...values,size+1);
  const hasMore=rows.length>size;
  if(hasMore)rows.pop();
  const nextCursor=hasMore&&rows.length?makeCursor(rows.at(-1),signature):null;
  const items=rows.map(({__page_sort,...rest})=>rest);
  return {items,total,nextCursor};
}
