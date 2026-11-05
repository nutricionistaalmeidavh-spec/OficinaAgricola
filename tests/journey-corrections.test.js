import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {openDatabase,migrate} from '../src/db.js';
import {migrateAssistencia} from '../src/assistencia-schema.js';
import {createCommonDataAdapter} from '../src/platform/common-data-adapter.js';
import {createAsyncWorkshopServices} from '../src/platform/async-workshop-services.js';
import {normalizePublicOrigin,workshopRequestUrl} from '../src/platform/public-access.js';

function workshop(){
  const db=openDatabase(':memory:');migrate(db);migrateAssistencia(db);
  return {db,s:createAsyncWorkshopServices(createCommonDataAdapter({engine:'sqlite',db}))};
}

test('busca encontra cliente antigo fora da primeira página e veículo/OS por placa e chassi',async()=>{
  const {db,s}=workshop();
  try{
    const c=await s.createCustomer({name:'Zelia frota antiga'});
    const m=await s.createMachine({customerId:c.id,type:'Carro',brand:'Fiat',model:'Uno',plate:'ABC1D23',vin:'9BWZZZ377VT004251'});
    const order=await s.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Revisão'});
    for(let i=0;i<205;i++)await s.createCustomer({name:'A cliente '+String(i).padStart(3,'0')});
    assert.equal((await s.listCustomers()).some(row=>row.id===c.id),false);
    const page=await s.listCustomersPage({search:'zelia'});
    assert.equal(page.total,1);assert.equal(page.items[0].id,c.id);
    for(const term of ['abc-1d23','9bwzzz377vt004251']){
      assert.equal((await s.listMachinesPage({search:term})).items[0].id,m.id);
      assert.equal((await s.listWorkOrdersPage({search:term})).items[0].id,order.id);
    }
  }finally{db.close();}
});

test('dashboard e relatório separam orçamento, aprovação pendente e aprovada com o mesmo contrato',async()=>{
  const {db,s}=workshop();
  try{
    const c=await s.createCustomer({name:'Cliente'}),m=await s.createMachine({customerId:c.id,type:'Carro'});
    for(const status of ['ORCAMENTO','AGUARDANDO_APROVACAO','APROVADA']){
      const order=await s.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:status});
      db.prepare('UPDATE work_orders SET status=? WHERE id=?').run(status,order.id);
    }
    const dashboard=await s.getDashboard({role:'TECNICO'}),report=await s.getOperationalReport({includeFinance:false});
    assert.equal(dashboard.board.diagnostico.count,0);
    assert.equal(dashboard.board.orcamento.count,1);
    assert.equal(dashboard.board.aprovacao.count,1);
    assert.equal(dashboard.board.aprovada.count,1);
    assert.deepEqual(dashboard.flow,report.flow);
    assert.equal(dashboard.flow.flatMap(g=>g.statuses).length,7);
  }finally{db.close();}
});

test('diagnóstico consecutivo e retorno ao serviço usam versões confirmadas e deixam histórico',async()=>{
  const {db,s}=workshop();
  try{
    const c=await s.createCustomer({name:'Cliente'}),m=await s.createMachine({customerId:c.id,type:'Carro'});
    let order=await s.createWorkOrder({customerId:c.id,machineId:m.id,problemReported:'Correção'});
    order=await s.updateWorkOrder(order.id,{diagnosis:'Primeiro',expectedVersion:order.version});
    order=await s.updateWorkOrder(order.id,{diagnosis:'Revisado',expectedVersion:order.version});
    assert.equal(order.diagnosis,'Revisado');
    db.prepare("UPDATE work_orders SET status='PRONTA' WHERE id=?").run(order.id);
    order=await s.getWorkOrder(order.id);
    assert.ok(order.availableTransitions.includes('EM_SERVICO'));
    const returned=await s.transitionWorkOrder({workOrderId:order.id,toStatus:'EM_SERVICO',reason:'Ajustar ruído',expectedVersion:order.version});
    assert.equal(returned.status,'EM_SERVICO');
    assert.ok((await s.getWorkOrderHistory(order.id)).some(row=>row.reason==='Ajustar ruído'));
  }finally{db.close();}
});

test('preço/total alterados não gravam venda, caixa ou estoque; confirmação válida não duplica',async()=>{
  const {db,s}=workshop();
  try{
    const part=await s.createPart({sku:'TEST-PREVIEW',description:'Filtro',salePriceCents:2500});
    await s.postStockMovement({partId:part.id,type:'ENTRADA',quantity:5});
    await s.openCashSession({requestId:'preview-cash'});
    const input={requestId:'preview-sale',paymentMethod:'PIX',discountCents:100,
      items:[{partId:part.id,quantity:2,expectedUnitPriceCents:2000}],expectedTotalCents:3900};
    await assert.rejects(s.createSale(input),/Preço/);
    input.items[0].expectedUnitPriceCents=2500;
    await assert.rejects(s.createSale(input),/prévia/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_movements').get().n,0);
    assert.equal((await s.getPart(part.id)).quantity,5);
    input.expectedTotalCents=4900;
    const saved=await s.createSale(input),retry=await s.createSale(input);
    assert.equal(saved.id,retry.id);assert.equal(saved.total_cents,4900);
    assert.equal((await s.getPart(part.id)).quantity,3);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_events').get().n,1);
  }finally{db.close();}
});

test('origem externa é opt-in HTTPS; host arbitrário e URLs ambíguas continuam bloqueados',()=>{
  assert.equal(normalizePublicOrigin(),null);
  assert.equal(normalizePublicOrigin('https://oficina.example'), 'https://oficina.example');
  for(const value of ['http://oficina.example','https://user:pass@oficina.example','https://oficina.example/path','https://oficina.example?key=x','https://localhost'])
    assert.throws(()=>normalizePublicOrigin(value));
  const origin=normalizePublicOrigin('https://oficina.example');
  assert.equal(workshopRequestUrl('/approval.html','oficina.example',origin).origin,origin);
  assert.equal(workshopRequestUrl('/api/health','127.0.0.1:3344',origin).origin,'http://127.0.0.1:3344');
  assert.throws(()=>workshopRequestUrl('/','evil.example',origin));
  assert.throws(()=>workshopRequestUrl('/','oficina.example'));
  assert.throws(()=>workshopRequestUrl('//evil.example/','oficina.example',origin));
});

function diagnosisUi(send){
  const button={disabled:false},input={value:'Texto do técnico',readOnly:false},errors={textContent:'',replaceChildren(){this.textContent='';},appendChild(){}};
  const form={setAttribute(){},removeAttribute(){}};
  const calls=[],messages=[];
  const os={id:9,version:1,os_number:100};
  const ctx=vm.createContext({state:{modalToken:1},modalSession:{dirty:true,busy:false},dirtyInputs:new WeakSet(),
    $:(selector)=>selector.includes('button')?button:selector==='textarea'?input:errors,
    api:async(path,options)=>{calls.push(options.body);return send(options.body);},
    toast:message=>messages.push(message),friendlyUiMessage:String,
    document:{createElement:()=>({})},confirm:()=>false});
  vm.runInContext(readFileSync('public/app-journey.js','utf8'),ctx);
  return {ctx,os,button,input,errors,calls,messages,save:()=>ctx.saveWorkOrderDiagnosis({preventDefault(){},currentTarget:form},9,os)};
}

test('interface atualiza versão após diagnóstico e conserva texto quando salvar falha',async()=>{
  let version=1;
  const ui=diagnosisUi(async body=>{assert.equal(body.expectedVersion,version);return {version:++version,diagnosis:body.diagnosis};});
  await ui.save();await ui.save();
  assert.deepEqual(ui.calls.map(c=>c.expectedVersion),[1,2]);
  assert.equal(ui.os.version,3);assert.equal(ui.ctx.modalSession.dirty,false);
  const failed=diagnosisUi(async()=>{throw new Error('Rede indisponível');});
  await failed.save();assert.equal(failed.input.value,'Texto do técnico');
  assert.equal(failed.ctx.modalSession.dirty,true);assert.equal(failed.button.disabled,false);
  assert.match(failed.errors.textContent,/Rede/);
});

test('clique duplo no diagnóstico só envia uma operação enquanto aguarda confirmação',async()=>{
  let finish;
  const ui=diagnosisUi(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=ui.save();await ui.save();assert.equal(ui.calls.length,1);
  finish({version:2});await pending;
  assert.equal(ui.button.disabled,false);assert.equal(ui.ctx.modalSession.busy,false);
});

test('troca de contexto conserva rascunho quando cancelada e bloqueia operação pendente',()=>{
  const code=readFileSync('public/app-core.js','utf8');
  const ctx=vm.createContext({state:{pageDirty:true},modalSession:{dirty:true,busy:false},confirm:()=>false,
    toast(){},closeModal(){ctx.modalSession=null;},window:{},document:{}});
  vm.runInContext(code.slice(code.indexOf('function allowLeaveWorkshop()')),ctx);
  assert.equal(ctx.allowLeaveWorkshop(),false);assert.equal(ctx.state.pageDirty,true);
  ctx.confirm=()=>true;ctx.modalSession.busy=true;
  assert.equal(ctx.allowLeaveWorkshop(),false);assert.equal(ctx.state.pageDirty,true);
  ctx.modalSession.busy=false;assert.equal(ctx.allowLeaveWorkshop(),true);
  assert.equal(ctx.state.pageDirty,false);assert.equal(ctx.modalSession,null);
});
