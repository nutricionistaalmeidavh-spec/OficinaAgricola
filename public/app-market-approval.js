function marketApprovalActions(office){if(!office)return;
 $('#approvalNew').onclick=()=>showModal('Gerar link de aprovação','<form class="form-stack"><label>ID da OS<input name="workOrderId" type="number" min="1" required></label><button class="btn primary">Gerar link</button></form>',async fd=>{
 const id=Number(formObj(fd).workOrderId);
 const result=await api('/api/work-orders/'+id+'/quote/approval-link',{method:'POST',body:{expiresInHours:48,requestId:newCommandId()}});
 showModal('Link para o cliente','<p>Compartilhe somente com o responsável.</p><label>Link<input readonly value="'+esc(new URL(result.path,location.href).href)+'"></label><p class="muted">Para acesso externo, configure HTTPS próprio.</p>');
 });
}
