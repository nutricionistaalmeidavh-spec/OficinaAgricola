function marketApprovalActions(office){
  if(!office)return;
  $('#approvalNew').onclick=()=>approvalOrderPicker();
}
function approvalOrderPicker(){
  showModal('Escolher orçamento para aprovação',`<form class="form-stack">
    <label>Buscar OS<input id="approvalSearch" type="search" placeholder="Número, cliente, placa ou modelo"></label>
    <label>OS aguardando aprovação<select id="approvalOrder" name="workOrderId" required><option value="">Selecione</option></select></label>
    <small id="approvalSearchNotice" role="status"></small><button id="approvalMore" class="btn sm" type="button" hidden>Carregar mais</button>
    <button class="btn primary" type="submit">Preparar link</button></form>`,async fd=>{
      const os=await api('/api/work-orders/'+Number(fd.get('workOrderId')));
      openQuoteApproval(os.id,os.os_number);
    });
  const picker=bindPagedSelector({select:$('#approvalOrder'),search:$('#approvalSearch'),more:$('#approvalMore'),notice:$('#approvalSearchNotice'),
    path:'/api/work-orders/page',extra:{status:'AGUARDANDO_APROVACAO'},label:o=>`OS #${o.os_number} · ${o.customer_name} · ${o.machine_model||''}`});
  void picker.load();
}
async function startApprovalRequest(id,number){
  const button=$('#submitQuote');if(button?.disabled)return;
  if(modalSession?.dirty){toast('Salve as alterações antes de solicitar aprovação.',true);return;}
  if(button)button.disabled=true;
  if(modalSession)modalSession.busy=true;
  try{
    const current=await api(`/api/work-orders/${id}`);
    if(current.status==='ORCAMENTO'){
      try{await api(`/api/work-orders/${id}/quote/submit`,{method:'POST',body:{}});}
      catch(error){
        const confirmed=await api(`/api/work-orders/${id}`);
        if(confirmed.status!=='AGUARDANDO_APROVACAO')throw error;
      }
    }else if(current.status!=='AGUARDANDO_APROVACAO')throw new Error('A OS não aguarda aprovação. Consulte o estado atual.');
    toast(`OS #${number} aguardando decisão. Nenhuma mensagem foi enviada.`);
    openQuoteApproval(id,number);
  }catch(error){toast(error.message,true);}
  finally{if(button)button.disabled=false;if(modalSession)modalSession.busy=false;}
}
function openQuoteApproval(id,number){
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  const clientToken=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
  showModal(`Aprovação da OS #${number}`,`<form class="form-stack">
    <p>A OS aguarda a decisão do cliente. Gerar o link não envia mensagem nem registra aprovação.</p>
    <p class="muted">Um novo link substitui os anteriores desta OS. Para acesso fora desta máquina, configure uma origem HTTPS própria; nenhum serviço pago é obrigatório.</p>
    <label>Validade do link<select name="expiresInHours"><option value="24">24 horas</option><option value="48" selected>48 horas</option><option value="168">7 dias</option></select></label>
    <button class="btn primary" type="submit">Gerar link para compartilhar</button>
    <button class="btn" type="button" id="approvalBackOrder">Voltar à OS</button></form>`,async fd=>{
      const result=await api(`/api/work-orders/${id}/quote/approval-link`,{method:'POST',body:{expiresInHours:Number(fd.get('expiresInHours')),clientToken}});
      const url=result.url||new URL(result.path,location.href).href;
      showModal(`Link da OS #${number} criado`,`<div class="form-stack">
        <p role="status">Link criado. Nenhuma mensagem foi enviada. Válido até ${esc(dt(result.expiresAt))}.</p>
        <p class="${result.externalAccess?'muted':'error'}">${result.externalAccess?'Acesso externo configurado. Compartilhe apenas com o responsável pelo orçamento.':'Este link usa o endereço local. Ele não funciona no celular do cliente fora desta máquina. Configure HTTPS próprio antes de compartilhar externamente.'}</p>
        <label>Link de aprovação<input readonly id="approvalShareUrl" value="${esc(url)}"></label>
        <button class="btn primary" type="button" id="approvalCopy">Copiar link</button>
        <button class="btn" type="button" id="approvalCheck">Consultar decisão e voltar à OS</button></div>`);
      $('#approvalCopy').onclick=async()=>{
        try{await navigator.clipboard.writeText(url);toast('Link copiado. Envie ao responsável pelo seu canal de atendimento.');}
        catch{$('#approvalShareUrl').select();toast('Selecione e copie o link.');}
      };
      $('#approvalCheck').onclick=()=>openWorkOrder(id).catch(error=>toast(error.message,true));
    });
  $('#approvalBackOrder').onclick=()=>openWorkOrder(id).catch(error=>toast(error.message,true));
}
