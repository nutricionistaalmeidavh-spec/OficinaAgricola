'use strict';
const approvalParams=new URLSearchParams(location.search);
const token=approvalParams.get('token')||'';
const unit=approvalParams.get('unit')||'';
const notice=document.querySelector('#notice'),box=document.querySelector('#proposal');
const money=v=>(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const el=id=>document.getElementById(id);
function message(v){notice.textContent=v;notice.hidden=false;}
async function apiApproval(method,body){
 const response=await fetch('/api/public/approval/'+encodeURIComponent(token)+(unit?'?unit='+encodeURIComponent(unit):''),{
 method,headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',
 body:body?JSON.stringify(body):undefined
 });
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'Erro na operação');
 return result;
}
async function load(){
 el('retry').hidden=true;el('retry').disabled=true;
 if(!/^[a-f0-9]{64}$/.test(token)){message('Link inválido. Solicite outro à oficina.');return;}
 try{
  const data=await apiApproval('GET');
  if(data.status!=='ATIVO'){message(data.status==='APROVADO'?'Orçamento aprovado.':'Orçamento já respondido.');return;}
  el('order-number').textContent='Ordem de Serviço nº '+data.workOrderNumber;
  const host=el('items');host.replaceChildren();
  for(const item of data.items){
   const row=document.createElement('div');row.className='item';
   const description=document.createElement('span');description.textContent=item.description+' · '+item.quantity+' unidade(s)';
   const price=document.createElement('strong');price.textContent=money(item.totalCents);
   row.append(description,price);host.append(row);
  }
  el('total').textContent=money(data.totalCents);
  el('expiry').textContent='Prazo do link: '+new Date(data.expiresAt).toLocaleString('pt-BR');
  notice.hidden=true;box.hidden=false;
 }catch(error){message(error.message);el('retry').hidden=false;}finally{el('retry').disabled=false;}
}
async function decide(decision){
 const reason=el('reason').value.trim();
 if(decision==='REJEITAR'&&!reason){message('Informe o motivo da reprovação.');return;}
 if(!confirm(decision==='APROVAR'?'Autorizar o serviço?':'Reprovar o orçamento?'))return;
 el('approve').disabled=true;el('reject').disabled=true;
 try{
  const data=await apiApproval('POST',{decision,reason});
  box.hidden=true;message(data.status==='APROVADO'?'Serviço autorizado.':'Reprovação registrada.');
 }catch(error){message('A decisão ainda não foi confirmada. '+error.message+' Consulte a situação antes de tentar novamente.');el('retry').hidden=false;el('retry').disabled=false;el('approve').disabled=false;el('reject').disabled=false;}
}
el('retry').addEventListener('click',()=>load());
el('approve').addEventListener('click',()=>decide('APROVAR'));
el('reject').addEventListener('click',()=>decide('REJEITAR'));
void load();
