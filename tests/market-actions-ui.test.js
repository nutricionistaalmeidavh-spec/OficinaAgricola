import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const marketActionsSource=readFileSync(new URL('../public/app-market-actions.js',import.meta.url),'utf8');

function bindCrmCompleteButtons(buttons){
 const dialogs=[];
 const context={
  document:{getElementById:()=>({hidden:false})},
  $:()=>buttons[0]??null,
  $$:()=>buttons,
  marketCrmActions:()=>{},
  marketFleetActions:()=>{},
  marketUnitActions:()=>{},
  marketReferenceActions:()=>{},
  marketApprovalActions:()=>{},
  showModal:(...args)=>dialogs.push(args)
 };
 runInNewContext(marketActionsSource,context);
 context.bindMarketActions({office:true,admin:true,units:[]});
 return dialogs;
}

test('CRM e Frotas abre com zero contatos pendentes sem erro de forEach',()=>{
 assert.doesNotThrow(()=>bindCrmCompleteButtons([]));
});

test('CRM e Frotas vincula a ação Concluir a todos os contatos pendentes',()=>{
 const buttons=[
  {dataset:{crmComplete:'11'}},
  {dataset:{crmComplete:'12'}}
 ];
 const dialogs=bindCrmCompleteButtons(buttons);
 for(const button of buttons)assert.equal(typeof button.onclick,'function');
 buttons[1].onclick();
 assert.equal(dialogs.length,1);
 assert.equal(dialogs[0][0],'Concluir contato');
});
