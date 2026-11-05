function marketUnitActions(admin,units){
 if(!admin)return;
 $('#unitNew').onclick=()=>showModal('Nova unidade','<form class="form-stack"><label>Código<input name="code" required maxlength="32" placeholder="FILIAL-1"></label><label>Nome<input name="name" required maxlength="120"></label><button class="btn primary">Cadastrar</button></form>',async fd=>{
  await api('/api/units',{method:'POST',body:{...formObj(fd),requestId:newCommandId()}});
  toast('Unidade cadastrada');await refreshCurrentPage();
 });
 const unitAssign=$('#unitAssign');
 if(window.OficinaTenant?.enabled){if(unitAssign)unitAssign.hidden=true;return;}
 unitAssign.onclick=()=>showModal('Vincular OS à unidade','<form class="form-stack"><label>ID da OS<input name="workOrderId" type="number" min="1" required></label><label>Unidade<select name="unitId">'+units.map(u=>'<option value="'+u.id+'">'+esc(u.name)+'</option>').join('')+'</select></label><button class="btn primary">Vincular</button></form>',async fd=>{
  const data=formObj(fd);
  await api('/api/units/assign',{method:'POST',body:{workOrderId:Number(data.workOrderId),unitId:Number(data.unitId),requestId:newCommandId()}});
  toast('OS atribuída');await refreshCurrentPage();
 });
}
