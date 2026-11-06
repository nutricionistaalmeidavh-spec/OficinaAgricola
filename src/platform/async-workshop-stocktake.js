import {randomBytes} from 'node:crypto';
import {normalizeGtin} from './inventory-gtin.js';

// Physical inventory counts never mutate stock until explicit administrator application.
// Every applied difference goes through the same parts + inventory_movements transaction.
const id=()=>randomBytes(6).readUIntBE(0,6);
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const key=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;};
const amount=x=>{const n=Number(x);if(x==null||x===''||!Number.isFinite(n)||n<0||n>1000000)fail('Quantidade inválida');return n;};
const now=()=>new Date().toISOString();
const changes=x=>Number(x?.changes??x?.meta?.changes??0);
const diff=(a,b)=>Number((Number(a)-Number(b)).toFixed(8));

export function createAsyncWorkshopStocktakes(port){
 if(!['postgres','sqlite'].includes(port?.engine)){
  const unsupported=async()=>fail('Inventário físico exige PostgreSQL local',501);
  return Object.freeze({findPartByBarcode:unsupported,createStocktake:unsupported,
   getStocktake:unsupported,listStocktakes:unsupported,saveStocktakeCounts:unsupported,applyStocktake:unsupported});
 }
 async function findPartByBarcode(value){
  const code=normalizeGtin(value);
  if(!code)fail('Informe um código EAN/GTIN válido');
  return port.first('SELECT * FROM parts WHERE barcode=? AND active=1',[code]);
 }
 async function getStocktake(stocktakeId){
  const header=await port.first('SELECT * FROM stocktakes WHERE id=?',[key(stocktakeId)]);
  if(!header)fail('Inventário não encontrado',404);
  const rows=await port.all(`SELECT l.*,p.sku,p.description,p.barcode,p.quantity current_quantity,p.unit FROM stocktake_lines l
   JOIN parts p ON p.id=l.part_id WHERE l.stocktake_id=? ORDER BY p.description,p.id`,[header.id]);
  return {...header,lines:rows.map(x=>({...x,
   difference:x.counted_quantity==null?null:diff(x.counted_quantity,x.expected_quantity),
   stale:diff(x.current_quantity,x.expected_quantity)!==0})),
   pending:rows.filter(x=>x.counted_quantity==null).length,
   discrepancies:rows.filter(x=>x.counted_quantity!=null&&diff(x.counted_quantity,x.expected_quantity)!==0).length};
 }
 async function listStocktakes({limit=30}={}){
  const n=Math.min(100,Math.max(1,Number(limit)||30));
  return port.all('SELECT * FROM stocktakes ORDER BY created_at DESC,id DESC LIMIT ?',[n]);
 }
 async function createStocktake({name='Inventário físico',partIds=null,actorId=null}={}){
  const description=String(name??'').trim(),actor=actorId==null?null:key(actorId);
  if(!description||description.length>160)fail('Nome do inventário inválido');
  let ids=null;
  if(partIds!=null){
   if(!Array.isArray(partIds)||!partIds.length||partIds.length>500)
    fail('Selecione de 1 a 500 peças por inventário');
   ids=partIds.map(key).sort((a,b)=>a-b);
   if(new Set(ids).size!==ids.length)fail('Peças duplicadas no inventário');
  }
  const stocktakeId=id(),at=now();
  await port.transaction(async tx=>{
   const parts=ids?await tx.all(
    'SELECT id,quantity FROM parts WHERE active=1 AND id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id',ids
   ):await tx.all('SELECT id,quantity FROM parts WHERE active=1 ORDER BY id LIMIT 501');
   if(!parts.length||parts.length>500||ids&&parts.length!==ids.length)
    fail('Inventário exige de 1 a 500 peças ativas; filtre por lote quando exceder o limite',409);
   await tx.run(`INSERT INTO stocktakes(id,name,status,created_by,created_at,updated_at)
    VALUES(?,?,'ABERTO',?,?,?)`,[stocktakeId,description,actor,at,at]);
   for(const part of parts)
    await tx.run(`INSERT INTO stocktake_lines(id,stocktake_id,part_id,expected_quantity)
      VALUES(?,?,?,?)`,[id(),stocktakeId,Number(part.id),Number(part.quantity)]);
  });
  return getStocktake(stocktakeId);
 }
 async function saveStocktakeCounts({stocktakeId,counts,actorId=null}={}){
  const sid=key(stocktakeId),actor=actorId==null?null:key(actorId);
  if(!Array.isArray(counts)||!counts.length||counts.length>500)
   fail('Informe de 1 a 500 contagens');
  const normalized=counts.map(x=>({partId:key(x.partId),quantity:amount(x.quantity)}));
  if(new Set(normalized.map(x=>x.partId)).size!==normalized.length)
   fail('Peça repetida na conferência');
  await port.transaction(async tx=>{
   const header=await tx.first('SELECT * FROM stocktakes WHERE id=?'+(port.engine==='postgres'?' FOR UPDATE':''),[sid]);
   if(!header)fail('Inventário não encontrado',404);
   if(header.status!=='ABERTO')fail('Inventário já finalizado; contagens não podem mudar',409);
   const stamp=now();
   for(const row of normalized){
    const line=await tx.first('SELECT id,counted_quantity FROM stocktake_lines WHERE stocktake_id=? AND part_id=?',[sid,row.partId]);
    if(!line)fail('Peça não pertence ao inventário',409);
    if(line.counted_quantity!=null&&Number(line.counted_quantity)===row.quantity)continue;
    await tx.run('UPDATE stocktake_lines SET counted_quantity=? WHERE id=?',[row.quantity,line.id]);
    await tx.run(`INSERT INTO stocktake_count_events(
      id,stocktake_line_id,previous_quantity,counted_quantity,created_by,created_at
     ) VALUES(?,?,?,?,?,?)`,[id(),line.id,line.counted_quantity,row.quantity,actor,stamp]);
   }
   await tx.run('UPDATE stocktakes SET updated_at=? WHERE id=?',[stamp,sid]);
  });
  return getStocktake(sid);
 }
 async function applyStocktake({stocktakeId,actorId,actorRole,reason=''}={}){
  const sid=key(stocktakeId),actor=key(actorId),why=String(reason??'').trim();
  if(actorRole!=='ADMIN')fail('Somente administrador pode aplicar inventário',403);
  if(why.length<5||why.length>500)fail('Motivo do ajuste obrigatório (5 a 500 caracteres)');
  await port.transaction(async tx=>{
   const header=await tx.first('SELECT * FROM stocktakes WHERE id=?'+(port.engine==='postgres'?' FOR UPDATE':''),[sid]);
   if(!header)fail('Inventário não encontrado',404);
   if(header.status==='APLICADO')return; // replay cannot create a second ledger movement.
   if(header.status!=='ABERTO')fail('Status do inventário inválido',409);
   const lines=await tx.all('SELECT * FROM stocktake_lines WHERE stocktake_id=? ORDER BY part_id',[sid]);
   if(!lines.length||lines.some(x=>x.counted_quantity==null))
    fail('Existem contagens pendentes; conclua a conferência antes de aplicar',409);
   const stamp=now();
   for(const line of lines){
    const part=await tx.first('SELECT id,quantity,active FROM parts WHERE id=?'+
     (port.engine==='postgres'?' FOR UPDATE':''),[line.part_id]);
    if(!part||Number(part.active)!==1)fail('Peça indisponível para inventário',409);
    if(Math.abs(Number(part.quantity)-Number(line.expected_quantity))>1e-8)
     fail('Saldo alterado após a contagem; faça recontagem em novo inventário',409);
   }
   for(const line of lines){
    const delta=diff(line.counted_quantity,line.expected_quantity);
    if(delta===0)continue;
    const update=await tx.run(`UPDATE parts SET quantity=quantity+?,updated_at=?
     WHERE id=? AND active=1 AND ABS(quantity-?)<0.00000001 AND quantity+?>=-0.00000001`,
      [delta,stamp,line.part_id,line.expected_quantity,delta]);
    if(changes(update)!==1)fail('Saldo alterado durante a conferência; faça recontagem',409);
    const movementId=id();
    await tx.run(`INSERT INTO inventory_movements(
     id,part_id,type,quantity_delta,note,created_by,created_at,source_type,source_item_id
    ) VALUES(?,?,'AJUSTE',?,?,?,?,?,?)`,
    [movementId,line.part_id,delta,why,actor,stamp,'STOCKTAKE_LINE',line.id]);
    await tx.run('UPDATE stocktake_lines SET movement_id=? WHERE id=?',[movementId,line.id]);
   }
   await tx.run(`UPDATE stocktakes SET status='APLICADO',applied_by=?,reason=?,applied_at=?,updated_at=?
    WHERE id=? AND status='ABERTO'`,[actor,why,stamp,stamp,sid]);
  });
  return getStocktake(sid);
 }
 return Object.freeze({findPartByBarcode,createStocktake,getStocktake,
  listStocktakes,saveStocktakeCounts,applyStocktake});
}
