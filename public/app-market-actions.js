function bindMarketActions(context){
 const {office,admin,units}=context;
 for(const id of ['crmNew','crmSync','fleetNew','fleetAssign','refNew','approvalNew']){const b=document.getElementById(id);if(b)b.hidden=!office;}
 for(const id of ['unitNew','unitAssign']){const b=document.getElementById(id);if(b)b.hidden=!admin;}
 marketCrmActions(office);
 marketFleetActions(office);
 marketUnitActions(admin,units);
 marketReferenceActions(office);
 marketApprovalActions(office);
 if(office)$('[data-crm-complete]').forEach(b=>b.onclick=()=>showModal('Concluir contato','<form class="form-stack"><label>Resultado<textarea required name="outcome" maxlength="1000"></textarea></label><button class="btn primary">Concluir</button></form>',async fd=>{await api('/api/crm/tasks/'+b.dataset.crmComplete+'/complete',{method:'POST',body:{...formObj(fd),requestId:newCommandId()}});toast('Contato concluído');await refreshCurrentPage()}));
}
