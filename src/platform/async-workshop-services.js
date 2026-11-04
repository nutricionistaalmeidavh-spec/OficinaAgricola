import {randomBytes,createHash} from 'node:crypto';

// Async canonical service layer for PostgreSQL and D1. Each command is
// explicitly transactional on its backend; never delegate to legacy SQLite.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const numericId=value=>{
 const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('Identificador inválido');return n;
};
const id=()=>randomBytes(6).readUIntBE(0,6);
const iso=()=>new Date().toISOString();
const text=value=>String(value??'').trim();
const cents=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)fail('Valor monetário inválido');return n;};
const changes=value=>Number(value?.changes??value?.meta?.changes??0);
const serial=value=>Number.isFinite(Number(value))?Number(value):value;
async function atomic(port,queries){
 if(port.engine==='d1')return port.batch(queries);
 return port.transaction(async tx=>{
   const out=[];for(const q of queries)out.push(await tx.run(q.sql,q.params));
   return out;
 });
}
const select=(sql,params=[])=>({sql,params});
export function createAsyncWorkshopServices(port){
 if(!['d1','postgres'].includes(port?.engine))fail('Serviço exige D1 ou PostgreSQL nativo');
 async function createCustomer(input={}){
   const name=text(input.name);if(!name)fail('Nome do cliente obrigatório');
   const customerId=id(),at=iso();
   await port.run(`INSERT INTO customers(id,name,document,phone,email,address,notes,active,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,1,?,?)`,[
     customerId,name,text(input.document),text(input.phone),
     text(input.email),text(input.address),text(input.notes),at,at
   ]);
   return port.first('SELECT * FROM customers WHERE id=?',[customerId]);
 }
 async function createMachine(input={}){
   const customerId=numericId(input.customerId);
   if(!await port.first('SELECT id FROM customers WHERE id=? AND active=1',[customerId]))
     fail('Cliente não encontrado',404);
   const type=text(input.type);if(!type)fail('Tipo de máquina obrigatório');
   const machineId=id(),at=iso();
   await port.run(`INSERT INTO machines(
     id,customer_id,type,brand,model,year,serial_number,internal_id,
     hour_meter,license_plate,vin,odometer_km,renavam,engine,fuel_type,notes,
     active,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,[
     machineId,customerId,type,text(input.brand),text(input.model),
     input.year==null?null:Number(input.year),text(input.serialNumber),
     text(input.internalId),Number(input.hourMeter??0),text(input.plate)||null,
     text(input.vin)||null,input.odometerKm==null?null:Number(input.odometerKm),
     text(input.renavam)||null,text(input.engine),text(input.fuelType)||null,
     text(input.notes),at,at
   ]);
   return port.first('SELECT * FROM machines WHERE id=?',[machineId]);
 }
 async function getWorkOrder(workOrderId){
   const row=await port.first('SELECT * FROM work_orders WHERE id=?',[numericId(workOrderId)]);
   if(!row)fail('Ordem de serviço não encontrada',404);
   return row;
 }
 async function createWorkOrder(input={}){
   const customerId=numericId(input.customerId),machineId=numericId(input.machineId);
   const problem=text(input.problemReported);if(!problem)fail('Problema relatado é obrigatório');
   const customer=await port.first('SELECT * FROM customers WHERE id=? AND active=1',[customerId]);
   if(!customer)fail('Cliente não encontrado',404);
   const machine=await port.first('SELECT * FROM machines WHERE id=? AND customer_id=? AND active=1',[machineId,customerId]);
   if(!machine)fail('Máquina não pertence ao cliente',409);
   const workOrderId=id(),at=iso(),priority=text(input.priority)||'NORMAL';
   if(!new Set(['BAIXA','NORMAL','ALTA','URGENTE']).has(priority))fail('Prioridade inválida');
   const fields=[
     workOrderId,customerId,machineId,text(input.enteredAt)||at,problem,
     text(input.diagnosis),null,input.estimatedDelivery??null,priority,
     text(input.internalNotes),JSON.stringify({id:customer.id,name:customer.name,
       document:customer.document,phone:customer.phone,address:customer.address}),
     JSON.stringify({id:machine.id,type:machine.type,brand:machine.brand,
       model:machine.model,vin:machine.vin}),at,at
   ];
   const statements=[
    select(`INSERT INTO work_orders(
       id,os_number,customer_id,machine_id,entered_at,problem_reported,
       diagnosis,technician_id,estimated_delivery,priority,internal_notes,
       status,snapshot_customer,snapshot_machine,created_at,updated_at
     ) VALUES(?,(SELECT COALESCE(MAX(os_number),0)+1 FROM work_orders),?,?,?,?,?,?,?,?,?,'ENTRADA',?,?,?,?)`,fields),
    select(`INSERT INTO work_order_status_history(
       work_order_id,from_status,to_status,reason,changed_at
     ) VALUES(?,NULL,'ENTRADA','Abertura da OS',?)`,[workOrderId,at]),
    select(`INSERT INTO domain_outbox(event_type,payload_json,created_at)
       VALUES('OS_CRIADA',?,?)`,[JSON.stringify({workOrderId}),at])
   ];
   await atomic(port,statements);
   return getWorkOrder(workOrderId);
 }
 async function createPart(input={}){
   const sku=text(input.sku),description=text(input.description);
   if(!sku||!description)fail('SKU e descrição são obrigatórios');
   const partId=id(),at=iso();
   await port.run(`INSERT INTO parts(
     id,sku,description,category,unit,cost_cents,sale_price_cents,
     quantity,min_stock,location,active,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,0,?,?,1,?,?)`,[
     partId,sku,description,text(input.category),text(input.unit)||'UN',
     cents(input.costCents??0),cents(input.salePriceCents??0),
     Number(input.minStock??0),text(input.location),at,at
   ]);
   return port.first('SELECT * FROM parts WHERE id=?',[partId]);
 }
 async function postStockMovement({partId,type,quantity,note='',workOrderId=null}={}){
   const p=numericId(partId),q=Number(quantity);
   if(!Number.isFinite(q)||q<=0||q>1000000)fail('Quantidade inválida');
   const allowed={ENTRADA:1,ESTORNO:1,SAIDA_MANUAL:-1,CONSUMO_OS:-1};
   if(!Object.hasOwn(allowed,type))fail('Tipo de movimentação inválido');
   const delta=q*allowed[type],at=iso(),movementId=id();
   const update=select(`UPDATE parts SET quantity=quantity+?,updated_at=?
     WHERE id=? AND active=1 AND quantity+?>=-0.00000001`,[delta,at,p,delta]);
   if(port.engine==='d1'){
     const result=await atomic(port,[
       update,
       select(`INSERT INTO inventory_movements(
         id,part_id,type,quantity_delta,work_order_id,note,created_at
       ) SELECT ?,?,?,?,?,?,? WHERE changes()=1`,[
         movementId,p,type,delta,workOrderId,text(note),at
       ])
     ]);
     if(changes(result[0])!==1)fail('Estoque insuficiente',409);
   }else await port.transaction(async tx=>{
     const updated=await tx.run(update.sql,update.params);
     if(changes(updated)!==1)fail('Estoque insuficiente',409);
     await tx.run(`INSERT INTO inventory_movements(
       id,part_id,type,quantity_delta,work_order_id,note,created_at
     ) VALUES(?,?,?,?,?,?,?)`,[movementId,p,type,delta,workOrderId,text(note),at]);
   });
   return {id:movementId,partId:p,type,quantityDelta:delta};
 }
 async function receivePayment(input={}){
   const workOrderId=numericId(input.workOrderId),amount=cents(input.amountCents);
   if(!amount)fail('Valor do recebimento inválido');
   const method=text(input.method),requestId=text(input.requestId);
   if(!method)fail('Forma de pagamento obrigatória');
   if(!requestId||requestId.length>128)fail('Identificador idempotente obrigatório');
   const fingerprint=createHash('sha256').update(JSON.stringify({workOrderId,amount,method})).digest('hex');
   const previous=await port.first('SELECT * FROM receipts WHERE request_id=?',[requestId]);
   if(previous){
     if(previous.request_payload_hash!==fingerprint)
       fail('Identificador de pagamento já utilizado para outra operação',409);
     return previous;
   }
   const receiptId=id(),eventId=id(),at=iso();
   const insert=select(`INSERT INTO receipts(
     id,work_order_id,amount_cents,method,received_at,request_id,request_payload_hash
   ) SELECT ?,?,?,?,?,?,? WHERE EXISTS(
     SELECT 1 FROM work_orders wo
     JOIN quotes q ON q.work_order_id=wo.id
     WHERE wo.id=? AND q.approval_status='APROVADO'
       AND wo.status<>'CANCELADA'
       AND wo.quote_total_cents-
         COALESCE((SELECT SUM(r.amount_cents) FROM receipts r
           WHERE r.work_order_id=wo.id AND r.reversed_at IS NULL),0)>=?
   )`,[
     receiptId,workOrderId,amount,method,at,requestId,fingerprint,workOrderId,amount
   ]);
   const event=select(`INSERT INTO payment_events(
     id,source_type,source_id,event_type,amount_cents,method,created_at
   ) SELECT ?,'OS_RECEIPT',?,'PAID',?,?,? FROM receipts WHERE id=?`,[
     eventId,receiptId,amount,method,at,receiptId
   ]);
   if(port.engine==='d1'){
     const output=await atomic(port,[insert,event]);
     if(changes(output[0])!==1)fail('Saldo insuficiente ou orçamento não aprovado',409);
   }else await port.transaction(async tx=>{
     // Lock the OS row to serialize concurrent receipts against approved total.
     const os=await tx.first('SELECT id FROM work_orders WHERE id=? FOR UPDATE',[workOrderId]);
     if(!os)fail('OS não encontrada',404);
     const output=await tx.run(insert.sql,insert.params);
     if(changes(output)!==1)fail('Saldo insuficiente ou orçamento não aprovado',409);
     await tx.run(event.sql,event.params);
   });
   return port.first('SELECT * FROM receipts WHERE id=?',[receiptId]);
 }
 async function financeSummary({from='1970-01-01T00:00:00.000Z',to='2999-12-31T23:59:59.999Z'}={}){
   const invoiced=await port.first(`SELECT COALESCE(SUM(q.total_cents),0) total
     FROM quotes q JOIN work_orders wo ON wo.id=q.work_order_id
     WHERE q.approval_status='APROVADO' AND wo.status<>'CANCELADA'
       AND q.approved_at BETWEEN ? AND ?`,[from,to]);
   const pending=await port.first(`SELECT COALESCE(SUM(CASE
     WHEN wo.quote_total_cents-COALESCE(r.paid,0)>0
     THEN wo.quote_total_cents-COALESCE(r.paid,0) ELSE 0 END),0) total
     FROM quotes q JOIN work_orders wo ON wo.id=q.work_order_id
     LEFT JOIN (SELECT work_order_id,SUM(amount_cents) paid
       FROM receipts WHERE reversed_at IS NULL GROUP BY work_order_id) r
       ON r.work_order_id=wo.id
     WHERE q.approval_status='APROVADO' AND wo.status<>'CANCELADA'
       AND q.approved_at BETWEEN ? AND ?`,[from,to]);
   const payments=await port.first(`SELECT COALESCE(SUM(amount_cents),0) total
     FROM payment_events WHERE created_at BETWEEN ? AND ?`,[from,to]);
   const expense=await port.first(`SELECT COALESCE(SUM(amount_cents),0) total
     FROM expenses WHERE paid_at IS NOT NULL AND paid_at BETWEEN ? AND ?`,[from,to]);
   const receivedCents=serial(payments.total),expensesCents=serial(expense.total);
   return {
     invoicedCents:serial(invoiced.total),
     receivedCents,pendingCents:serial(pending.total),expensesCents,
     resultCents:receivedCents-expensesCents
   };
 }
 return Object.freeze({
   createCustomer,createMachine,createWorkOrder,getWorkOrder,
   createPart,postStockMovement,receivePayment,financeSummary
 });
}
