function marketCrmActions(office){
 const plate=$('#plateLookup');
 plate.onclick=()=>showModal('Consultar placa local','<form class="form-stack"><label>Placa<input name="plate" required maxlength="8" placeholder="ABC1D23"></label><button class="btn primary">Consultar</button></form>',async fd=>{
  const row=await api('/api/vehicles/plate/'+encodeURIComponent(formObj(fd).plate));
  toast(row?['Veículo cadastrado',row.brand,row.model,row.year].filter(Boolean).join(' · '):'Placa não cadastrada localmente');
 });
 if(!office)return;
 $('#crmNew').onclick=async()=>{
  const customers=await api('/api/customers');
  showModal('Novo contato','<form class="form-stack"><label>Cliente<select name="customerId">'+customers.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('')+'</select></label><label>Assunto<input required name="title" maxlength="160"></label><label>Data<input required type="date" name="dueAt"></label><label>Canal<select name="channel"><option>MANUAL</option><option>TELEFONE</option><option>EMAIL</option><option>WHATSAPP</option></select></label><button class="btn primary">Salvar contato</button></form>',async fd=>{
   await api('/api/crm/tasks',{method:'POST',body:{...formObj(fd),requestId:newCommandId()}});
   toast('Contato registrado');await refreshCurrentPage();
  });
 };
 $('#crmSync').onclick=async()=>{
  const r=await api('/api/crm/maintenance/sync',{method:'POST',body:{daysAhead:7,requestId:newCommandId()}});
  toast(r.created+' lembrete(s) criado(s)');await refreshCurrentPage();
 };
}
