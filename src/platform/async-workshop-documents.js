import {renderDocumentFromData} from './document-html.js';

// Read-only document projections sourced from the same tenant's canonical SQL.
// No SQLite fallback, network dependency or mutation of customers' records.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const orderId=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1)fail('Ordem de serviço inválida',400);
 return n;
};
const decodeSnapshot=(value,label)=>{
 try{
  const data=typeof value==='string'?JSON.parse(value):value;
  if(!data||typeof data!=='object'||Array.isArray(data))
   throw Error('missing');
  return data;
 }catch{
  fail('Dados históricos de '+label+' indisponíveis; não é seguro imprimir informações incompletas',409);
 }
};
export function createAsyncWorkshopDocuments(port){
 if(!port||typeof port.first!=='function'||typeof port.all!=='function'||
    !['postgres','sqlite','d1'].includes(port.engine))
  throw Error('Renderer exige SQL por tenant');
 async function renderWorkOrderDocument(workOrderId,kind='work-order'){
  if(!['quote','work-order','delivery','receipt'].includes(kind))
    fail('Tipo de documento não suportado',404);
  const id=orderId(workOrderId);
  const os=await port.first('SELECT * FROM work_orders WHERE id=?',[id]);
  if(!os)fail('Ordem de serviço não encontrada',404);
  const company=await port.first('SELECT * FROM company_settings WHERE id=1');
  if(!company)fail('Dados da oficina indisponíveis',409);
  const quoteRow=await port.first('SELECT * FROM quotes WHERE work_order_id=?',[id]);
  if(kind==='quote'&&!quoteRow)fail('Orçamento não cadastrado para esta OS',409);
  const items=quoteRow
    ?await port.all('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id',[quoteRow.id])
    :[];
  const receipts=await port.all(
    'SELECT * FROM receipts WHERE work_order_id=? AND reversed_at IS NULL ORDER BY received_at',[id]);
  return renderDocumentFromData({
   os,company,customer:decodeSnapshot(os.snapshot_customer,'cliente'),
   machine:decodeSnapshot(os.snapshot_machine,'equipamento'),
   quote:quoteRow?{...quoteRow,items}:null,receipts
  },kind);
 }
 return Object.freeze({renderWorkOrderDocument});
}
