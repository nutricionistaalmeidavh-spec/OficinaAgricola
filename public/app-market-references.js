function marketReferenceActions(office){
 if(!office)return;
 $('#refNew').onclick=async()=>{
  const parts=await api('/api/parts');
  showModal('Referência técnica','<form class="form-stack"><label>Peça<select name="partId">'+parts.map(p=>'<option value="'+p.id+'">'+esc(p.sku+' · '+p.description)+'</option>').join('')+'</select></label><label>Fabricante<input name="manufacturer"></label><label>Código OEM declarado<input name="oemCode"></label><label>Código alternativo<input name="referenceCode"></label><label>Observações<textarea name="notes"></textarea></label><p class="muted">Dados informativos, sem homologação OEM.</p><button class="btn primary">Salvar referência</button></form>',async fd=>{
   await api('/api/technical-references',{method:'POST',body:{...formObj(fd),requestId:newCommandId()}});
   toast('Referência cadastrada');await refreshCurrentPage();
  });
 };
}
