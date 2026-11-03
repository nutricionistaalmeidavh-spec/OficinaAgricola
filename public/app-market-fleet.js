function marketFleetActions(office){
 if(!office)return;
 $('#fleetNew').onclick=async()=>{
  const customers=await api('/api/customers');
  showModal('Nova frota','<form class="form-stack"><label>Cliente<select name="customerId">'+customers.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('')+'</select></label><label>Nome da frota<input name="name" maxlength="120" required></label><button class="btn primary">Salvar</button></form>',async fd=>{
   await api('/api/fleets',{method:'POST',body:{...formObj(fd),requestId:newCommandId()}});
   toast('Frota salva');await refreshCurrentPage();
  });
 };
 $('#fleetAssign').onclick=()=>showModal('Vincular veículo','<form class="form-stack"><label>ID da frota<input name="fleetId" type="number" min="1" required></label><label>ID do veículo<input name="machineId" type="number" min="1" required></label><button class="btn primary">Vincular</button></form>',async fd=>{
  const data=formObj(fd);
  await api('/api/fleets/'+Number(data.fleetId)+'/vehicles',{method:'POST',body:{machineId:Number(data.machineId),requestId:newCommandId()}});
  toast('Veículo vinculado');await refreshCurrentPage();
 });
}
