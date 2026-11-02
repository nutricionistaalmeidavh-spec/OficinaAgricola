import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness(fetchImpl=async()=>({status:200,ok:true,text:async()=>JSON.stringify({message:'ok'})})){
  const writes=[];
  const node={set innerHTML(value){writes.push(value);},get innerHTML(){return writes.at(-1)||'';}};
  const document={
    querySelector(selector){if(selector==='#content')return node;return {textContent:'',classList:{add(){},remove(){},toggle(){}}};},
    querySelectorAll(){return [];},
  };
  const ctx=vm.createContext({
    document,window:{},localStorage:{getItem:()=>'',setItem(){},removeItem(){}},
    AbortController,DOMException,setTimeout,console,fetch:fetchImpl,
  });
  const stubs=[
    'function renderCustomers(){}',
    'function renderMachines(){}',
    'function renderWorkOrders(){}',
    'function renderInventory(){}',
    'function renderSchedule(){}',
    'function renderFinance(){}',
    'function renderReports(){}',
    'function renderTechnicians(){}',
    'function renderSettings(){}',
    'async function renderSales(){setContent("<div>Vendas</div>")}',
    'async function renderServices(){setContent("<div>Serviços</div>")}',
  ].join('\n');
  vm.runInContext(stubs,ctx);
  vm.runInContext(readFileSync('public/app-core.js','utf8'),ctx);
  return{ctx,writes,navigate:vm.runInContext('navigate',ctx)};
}

test('não reconstrói página quando a aba ativa é clicada novamente',async()=>{
  const ui=harness();
  await ui.navigate('sales');
  const count=ui.writes.length;
  assert.ok(count>0);
  await ui.navigate('sales');
  assert.equal(ui.writes.length,count);
  await ui.navigate('sales',{force:true});
  assert.ok(ui.writes.length>count);
});

test('consulta antiga não redesenha a aba que acabou de ser aberta',async()=>{
  let deliver;
  const ui=harness(()=>new Promise(resolve=>{deliver=resolve;}));
  vm.runInContext('async function renderServices(){const data=await api("/api/test");setContent(data.message)}',ui.ctx);
  const pending=ui.navigate('services');
  assert.equal(typeof deliver,'function');
  await ui.navigate('sales');
  const writes=ui.writes.length;
  deliver({status:200,ok:true,text:async()=>JSON.stringify({message:'OBSOLETE'})});
  await pending;
  assert.equal(ui.writes.length,writes);
  assert.notEqual(ui.writes.at(-1),'OBSOLETE');
});
