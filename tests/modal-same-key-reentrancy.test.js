import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Regressão do modal compartilhado: salvar contagem reabre o mesmo inventário.
function modalHarness(){
  const code=readFileSync('public/app-core.js','utf8');
  const start=code.indexOf('function showModal(');
  const end=code.indexOf('\nfunction closeModal(',start);
  assert.ok(start>=0&&end>start,'Contrato do modal disponível');
  const backdrop={
    classList:{hidden:true,contains(name){return name==='hidden'&&this.hidden;},
      remove(name){if(name==='hidden')this.hidden=false;}}
  };
  const form={setAttribute(){},removeAttribute(){}};
  const button={disabled:false};
  const body={innerHTML:'',childNodes:[],oninput:null,onchange:null};
  const title={textContent:''};
  const elements={
    '#modal':backdrop,'#modalBody':body,'#modalTitle':title,
    '#modal .modal-card':{focus(){}},'#modalBody form':form
  };
  const ctx=vm.createContext({
    $:(selector)=>selector==='button[type=submit]'?button:elements[selector]||null,
    $$:()=>[],
    state:{modalKey:null,modalToken:null},
    modalSession:{busy:false,dirty:false},
    beginModalSession(){},
    renderRegion(){},
    trackDirtyInputs(){},
    dirtyInputs:new WeakSet(),
    closeModal(){throw Error('Modal sucessor não pode ser fechado pelo callback anterior')},
    toast(){},
    friendlyUiMessage:String,
    FormData:class{constructor(){}}
  });
  vm.runInContext(code.slice(start,end),ctx);
  return {ctx,form};
}

test('salvar contagem e reabrir mesmo inventário não deixa modal travado como ocupado',async()=>{
  const {ctx,form}=modalHarness();
  ctx.showModal('Conferência — Peças','<form></form>',async()=>{
    ctx.showModal('Conferência — Peças','<form></form>',async()=>{});
  });
  await form.onsubmit({preventDefault(){}});
  assert.equal(ctx.modalSession.busy,false,'Novo formulário deve poder ser fechado ou editado');
  assert.equal(ctx.state.modalKey,'Conferência — Peças');
});

test('callback antigo não libera operação ocupada de um modal diferente',async()=>{
  const {ctx,form}=modalHarness();
  ctx.showModal('Inventário antigo','<form></form>',async()=>{
    ctx.showModal('Outra operação','<form></form>',async()=>{});
    ctx.modalSession.busy=true;
  });
  await form.onsubmit({preventDefault(){}});
  assert.equal(ctx.modalSession.busy,true,'Modal sucessor com outra chave mantém seu estado');
});
