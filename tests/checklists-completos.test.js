import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as vmModule from 'node:vm';
import {openDatabase,migrate} from '../src/db.js';
import {createCustomer,createMachine} from '../src/services/catalog.js';
import {createWorkOrder} from '../src/services/work-orders.js';
import {
  seedDefaultChecklists,createChecklistTemplate,updateChecklistTemplate,
  listChecklistTemplates,getChecklistTemplate,createWorkOrderChecklist,getWorkOrderChecklist
} from '../src/services/operations.js';

function fixture(){
  const db=openDatabase(':memory:');migrate(db);
  const customer=createCustomer(db,{name:'Cliente de teste'});
  const machine=createMachine(db,{customerId:customer.id,type:'AUTOMOVEL'});
  const order=createWorkOrder(db,{customerId:customer.id,machineId:machine.id,problemReported:'Revisão'});
  return {db,order};
}

test('checklists iniciais atendem oficina automotiva e máquinas sem depender de horímetro',()=>{
  const {db}=fixture();
  try{
    seedDefaultChecklists(db);
    const t=listChecklistTemplates(db);
    assert.equal(t.length,2);
    const entry=getChecklistTemplate(db,t.find(x=>x.kind==='ENTRADA').id);
    assert.match(entry.items.map(x=>x.label).join(' '),/Quilometragem/);
    assert.match(entry.items.map(x=>x.label).join(' '),/Avarias/);
    assert.match(entry.items.map(x=>x.label).join(' '),/Pneus/);
    seedDefaultChecklists(db);
    assert.equal(listChecklistTemplates(db).length,2);
  }finally{db.close();}
});
test('edição e desativação preservam rótulos e respostas anteriores de cada OS',()=>{
  const {db,order}=fixture();
  try{
    const template=createChecklistTemplate(db,{
      name:'Inspeção mecânica',kind:'PERSONALIZADO',
      items:[{label:'Freios',required:true},{label:'Pneus',required:false}]
    });
    const historical=createWorkOrderChecklist(db,order.id,template.id,[
      {position:1,response:'ATENCAO',note:'Pastilhas gastas'},
      {position:2,response:'OK'}
    ]);
    assert.ok(historical.completed_at);
    const updated=updateChecklistTemplate(db,template.id,{
      name:'Inspeção revisada',
      items:[{label:'Sistema de freios',required:true},{label:'Direção',required:true}]
    });
    assert.equal(updated.items.length,2);
    assert.equal(updated.items[0].label,'Sistema de freios');
    assert.equal(getWorkOrderChecklist(db,historical.id).responses[0].label_snapshot,'Freios');
    assert.equal(getWorkOrderChecklist(db,historical.id).responses[0].note,'Pastilhas gastas');
    updateChecklistTemplate(db,template.id,{active:false});
    assert.equal(listChecklistTemplates(db).length,0);
    assert.equal(listChecklistTemplates(db,{includeInactive:true})[0].active,0);
    assert.throws(()=>createWorkOrderChecklist(db,order.id,template.id,[{position:1,response:'OK'}]),/desativado/);
    assert.equal(getWorkOrderChecklist(db,historical.id).template_name_snapshot,'Inspeção mecânica');
    updateChecklistTemplate(db,template.id,{active:true});
    assert.equal(listChecklistTemplates(db).length,1);
  }finally{db.close();}
});
test('não permite apagar modelo histórico com atualização inválida',()=>{
  const {db}=fixture();
  try{
    const model=createChecklistTemplate(db,{name:'Qualidade',items:['Teste funcional']});
    assert.throws(()=>updateChecklistTemplate(db,model.id,{items:[]}),/inválido/);
    assert.throws(()=>updateChecklistTemplate(db,model.id,{items:[{label:'  '}]}),/inválido/);
    assert.equal(getChecklistTemplate(db,model.id).items[0].label,'Teste funcional');
  }finally{db.close();}
});
test('interface expõe gestão, assinatura, fotografia e relatório imprimível sem serviço pago',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../public/app-checklists.js',import.meta.url),'utf8');
  const orders=readFileSync(new URL('../public/app-orders.js',import.meta.url),'utf8');
  assert.match(html,/app-checklists\.js/);
  assert.match(html,/checklists\.css/);
  assert.match(ui,/openChecklistTemplatesManager/);
  assert.match(ui,/openChecklistSignatureModal/);
  assert.match(ui,/checklistEmbeddedImage/);
  assert.match(ui,/Imprimir \/ Salvar como PDF/);
  assert.match(orders,/data-check-view/);
});


test('relatório de checklist inclui imagens vinculadas e assinatura sem executar conteúdo do cliente',()=>{
  const vm=requireVm();
  const script=readFileSync(new URL('../public/app-checklists.js',import.meta.url),'utf8');
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
  const context=vm.createContext({esc:safe,dt:()=> '10/11/2026'});
  vm.runInContext(script,context);
  const html=vm.runInContext('checklistPrintHtml',context)(
    {os_number:42,customer_name:'Cliente <script>alert(1)</script>',
      machine_brand:'Carro',machine_model:'Teste'},
    {name:'Oficina Teste'},
    {template_name_snapshot:'Entrada',created_at:'2026-11-10',
      completed_at:'2026-11-10',
      responses:[{label_snapshot:'Pneus',response:'OK',note:'Sem avaria'}]},
    [
      {kind:'foto',src:'data:image/jpeg;base64,Zg==',note:'Foto dianteira',date:'2026-11-10'},
      {kind:'assinatura',src:'data:image/jpeg;base64,Zg==',note:'Responsável',date:'2026-11-10'}
    ]
  );
  assert.match(html,/Foto dianteira/);
  assert.match(html,/Assinatura coletada/);
  assert.match(html,/data:image\/jpeg;base64,Zg==/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
});

function requireVm(){
  return vmModule;
}
