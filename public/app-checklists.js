// Fluxo de checklists: independente de SaaS, utiliza APIs e anexos canônicos da OS.
const OFICINA_CHECKLIST_PRESETS=[
  {name:'Entrada automotiva',kind:'ENTRADA',items:['Fotos externas e internas','Placa e quilometragem','Combustível','Riscos, avarias e amassados','Pneus e estepe','Luzes e painel','Objetos, chave e acessórios','Queixa e observações do cliente']},
  {name:'Inspeção mecânica',kind:'PERSONALIZADO',items:['Pastilhas, discos e fluido de freio','Pneus e calibragem','Amortecedores e suspensão','Sistema de direção','Óleo e filtros','Arrefecimento e vazamentos','Bateria e alternador','Correias e mangueiras']},
  {name:'Revisão preventiva',kind:'PERSONALIZADO',items:['Quilometragem e revisão anterior','Troca de óleo e filtro','Filtro de ar e cabine','Fluidos e arrefecimento','Freios e pneus','Suspensão e direção','Iluminação e limpadores','Próxima revisão recomendada']},
  {name:'Execução do serviço',kind:'PERSONALIZADO',items:['Serviço autorizado e OS conferidos','Peças corretas selecionadas','Substituição executada','Torques e procedimentos conferidos','Peças consumidas registradas','Teste após execução','Área de trabalho limpa']},
  {name:'Controle de qualidade',kind:'PERSONALIZADO',items:['Serviços executados conferidos','Ausência de vazamentos','Scanner e luzes de advertência','Teste funcional ou de rodagem','Freios e direção após reparo','Conferência final pelo responsável','Pendências informadas ao cliente']},
  {name:'Entrega automotiva',kind:'ENTREGA',items:['Serviços e orçamento conferidos','Teste funcional final','Limpeza e proteção removidas','Pertences, chave e acessórios devolvidos','Luzes do painel conferidas','Orientações de uso e garantia','Condições de retirada comunicadas']},
  {name:'Segurança da oficina',kind:'PERSONALIZADO',items:['EPIs utilizados','Elevadores e cavaletes inspecionados','Ferramentas e dispositivos seguros','Área de trabalho sinalizada','Resíduos e fluidos armazenados','Extintores e saídas desobstruídos']}
];

function checklistTemplateRows(templates){
  return templates.map(function(t){
    return '<div class="checklist-template-row"><div><strong>'+esc(t.name)+'</strong>'+
      '<small>'+esc(t.kind)+' · '+(Number(t.active)?'Ativo':'Desativado')+'</small></div>'+
      '<div class="action-row"><button type="button" class="btn sm" data-ck-edit="'+t.id+'">Editar</button>'+
      '<button type="button" class="btn sm" data-ck-copy="'+t.id+'">Duplicar</button>'+
      '<button type="button" class="btn sm" data-ck-toggle="'+t.id+'">'+(Number(t.active)?'Desativar':'Reativar')+'</button></div></div>';
  }).join('');
}
async function openChecklistTemplatesManager(){
  if(state.user.role!=='ADMIN'){toast('Apenas administradores podem gerenciar modelos.',true);return;}
  const templates=await api('/api/checklist-templates?all=1');
  showModal('Modelos de checklist','<div class="form-stack checklist-manager">'+
    '<p class="muted">Crie modelos para entrada, inspeção, execução e entrega. Alterar um modelo não altera checklists já realizados.</p>'+
    '<div class="action-row"><button type="button" class="btn primary" id="ckNewTemplate">+ Novo modelo</button>'+
    '<button type="button" class="btn" id="ckInstallPresets">Adicionar modelos sugeridos</button></div>'+
    (templates.length?checklistTemplateRows(templates):'<p class="empty">Nenhum modelo cadastrado.</p>')+'</div>');
  $('#ckNewTemplate').onclick=function(){openChecklistTemplateEditor(null);};
  $('#ckInstallPresets').onclick=async function(){
    const button=this;button.disabled=true;
    try{
      const exists=new Set(templates.map(function(x){return x.name.toLowerCase();}));
      let created=0;
      for(const p of OFICINA_CHECKLIST_PRESETS){
        if(exists.has(p.name.toLowerCase()))continue;
        await api('/api/checklist-templates',{method:'POST',body:{name:p.name,kind:p.kind,items:p.items}});
        created++;
      }
      toast(created?created+' modelos adicionados':'Os modelos sugeridos já existem');
      await openChecklistTemplatesManager();
    }catch(error){toast(error.message,true);button.disabled=false;}
  };
  $$('[data-ck-edit]').forEach(function(btn){
    btn.onclick=async function(){try{openChecklistTemplateEditor(await api('/api/checklist-templates/'+btn.dataset.ckEdit));}catch(e){toast(e.message,true);}};
  });
  $$('[data-ck-copy]').forEach(function(btn){
    btn.onclick=async function(){try{const t=await api('/api/checklist-templates/'+btn.dataset.ckCopy);openChecklistTemplateEditor(Object.assign({},t,{id:null,name:t.name+' (cópia)'}));}catch(e){toast(e.message,true);}};
  });
  $$('[data-ck-toggle]').forEach(function(btn){
    btn.onclick=async function(){
      const t=templates.find(function(v){return String(v.id)===btn.dataset.ckToggle;});
      if(!t||!confirm((Number(t.active)?'Desativar':'Reativar')+' o modelo '+t.name+'? Os checklists antigos serão mantidos.'))return;
      btn.disabled=true;
      try{await api('/api/checklist-templates/'+t.id,{method:'PATCH',body:{active:!Number(t.active)}});await openChecklistTemplatesManager();}
      catch(error){toast(error.message,true);btn.disabled=false;}
    };
  });
}
function checklistItemEditorRow(item){
  const label=item&&item.label||'';
  const required=item&&item.required!==undefined?!!Number(item.required):true;
  return '<div class="checklist-item-editor"><input data-ck-label maxlength="240" required aria-label="Descrição do item" value="'+esc(label)+'" placeholder="Descreva o que deve ser verificado">'+
    '<label><input type="checkbox" data-ck-required '+(required?'checked':'')+'> Obrigatório</label>'+
    '<button type="button" class="btn sm" data-ck-remove aria-label="Remover item">Remover</button></div>';
}
function openChecklistTemplateEditor(template){
  const draft=template||{name:'',kind:'PERSONALIZADO',items:[{label:'',required:1}]};
  showModal(template&&template.id?'Editar modelo':'Novo modelo de checklist',
    '<form class="form-stack" id="ckTemplateForm">'+
    '<label>Nome do modelo<input name="name" required maxlength="120" value="'+esc(draft.name)+'"></label>'+
    '<label>Etapa<select name="kind"><option value="ENTRADA">Entrada</option><option value="PERSONALIZADO">Inspeção / execução / outros</option><option value="ENTREGA">Entrega</option></select></label>'+
    '<label>Itens de verificação</label><div id="ckEditorItems">'+(draft.items||[]).map(checklistItemEditorRow).join('')+'</div>'+
    '<button type="button" class="btn" id="ckAddItem">+ Adicionar item</button>'+
    '<p class="muted">Itens obrigatórios precisam ser respondidos. O histórico de checklists concluídos não será modificado.</p>'+
    '<button type="submit" class="btn primary">Salvar modelo</button></form>',
    async function(fd){
      const items=$('.checklist-item-editor',$('#ckEditorItems')).map(function(row){
        return {label:$('[data-ck-label]',row).value.trim(),required:$('[data-ck-required]',row).checked};
      });
      if(!items.length||items.some(function(item){return !item.label;}))throw new Error('Informe ao menos um item válido.');
      const body={name:fd.get('name'),kind:fd.get('kind'),items:items};
      await api(template&&template.id?'/api/checklist-templates/'+template.id:'/api/checklist-templates',
        {method:template&&template.id?'PATCH':'POST',body:body});
      toast('Modelo salvo');await openChecklistTemplatesManager();
    });
  $('#ckTemplateForm [name=kind]').value=draft.kind;
  $('#ckAddItem').onclick=function(){
    if($$('.checklist-item-editor').length>=100){toast('Limite de 100 itens por modelo.',true);return;}
    $('#ckEditorItems').insertAdjacentHTML('beforeend',checklistItemEditorRow({label:'',required:1}));
    $('#ckEditorItems .checklist-item-editor:last-child input').focus();
  };
  $('#ckEditorItems').onclick=function(event){
    const remove=event.target.closest('[data-ck-remove]');
    if(remove)remove.closest('.checklist-item-editor').remove();
  };
}
function checklistPhotoCaption(id,kind,note){
  return 'CHECKLIST:'+id+':'+kind+':'+String(note||'').trim().slice(0,120);
}
function filesForChecklist(files,id){
  const prefix='CHECKLIST:'+id+':';
  return files.filter(function(file){return String(file.caption||'').startsWith(prefix);});
}
async function viewWorkOrderChecklist(orderId,checklistId){
  const data=await Promise.all([api('/api/checklists/'+checklistId),api('/api/work-orders/'+orderId+'/attachments')]);
  const checklist=data[0],attachments=filesForChecklist(data[1],checklistId);
  if(Number(checklist.work_order_id)!==Number(orderId))throw new Error('Checklist não pertence a esta OS');
  const photos=attachments.filter(function(a){return String(a.caption||'').startsWith('CHECKLIST:'+checklistId+':foto:');});
  const signature=attachments.find(function(a){return String(a.caption||'').startsWith('CHECKLIST:'+checklistId+':assinatura:');});
  const rows=(checklist.responses||[]).map(function(r){
    return '<div class="checklist-answer"><strong>'+esc(r.label_snapshot)+'</strong><span>'+esc(r.response.replaceAll('_',' '))+'</span>'+
      (r.note?'<small>'+esc(r.note)+'</small>':'')+'</div>';
  }).join('');
  showModal(checklist.template_name_snapshot,
    '<div class="form-stack"><p class="muted">OS vinculada · '+dt(checklist.created_at)+' · '+(checklist.completed_at?'Concluído':'Incompleto')+'</p>'+
    rows+'<div class="checklist-evidence-summary"><strong>'+photos.length+' foto(s)</strong><span>'+(signature?'Assinatura coletada':'Sem assinatura do cliente')+'</span></div>'+
    '<div class="action-row"><button type="button" class="btn" id="ckPhoto">+ Foto</button>'+
    '<button type="button" class="btn" id="ckSignature">Assinatura do cliente</button>'+
    '<button type="button" class="btn primary" id="ckPdf">Imprimir / Salvar PDF</button></div>'+
    '<p class="muted">A assinatura desenhada é uma evidência visual de ciência do cliente, não uma assinatura digital certificada.</p></div>');
  $('#ckPhoto').onclick=function(){openChecklistPhotoModal(orderId,checklistId);};
  $('#ckSignature').onclick=function(){openChecklistSignatureModal(orderId,checklistId);};
  $('#ckPdf').onclick=function(){void printChecklistAsPdf(orderId,checklistId).catch(function(e){toast(e.message,true);});};
}
function openChecklistPhotoModal(orderId,checklistId){
  showModal('Foto do checklist','<form class="form-stack">'+
    '<label>Foto<input type="file" name="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label>'+
    '<label>Descrição<input name="note" maxlength="120" placeholder="Ex.: risco no para-choque"></label>'+
    '<button type="submit" class="btn primary">Anexar à OS</button></form>',async function(fd){
      const file=fd.get('file');
      if(!file||!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>5*1024*1024)throw new Error('Use uma foto JPG, PNG ou WebP de até 5 MB.');
      const base64=await fileToBase64(file);
      await api('/api/work-orders/'+orderId+'/attachments',{method:'POST',body:{
        requestId:newCommandId(),category:'OUTRO',caption:checklistPhotoCaption(checklistId,'foto',fd.get('note')),
        originalName:file.name,mimeType:file.type,base64:base64}});
      toast('Foto anexada');await viewWorkOrderChecklist(orderId,checklistId);
    });
}
function openChecklistSignatureModal(orderId,checklistId){
  showModal('Assinatura do cliente','<form class="form-stack">'+
    '<p class="muted">Peça ao cliente que assine no espaço abaixo, na tela. Esta imagem ficará vinculada à OS.</p>'+
    '<label>Nome do cliente ou responsável<input name="signer" required maxlength="120" autocomplete="name"></label>'+
    '<canvas class="checklist-signature" id="ckSignatureCanvas" width="720" height="260" aria-label="Área para assinatura"></canvas>'+
    '<button class="btn sm" type="button" id="ckClearSignature">Limpar assinatura</button>'+
    '<label class="checklist-consent"><input name="consent" type="checkbox" required> Confirmo que o cliente teve ciência do conteúdo e concordou em registrar sua assinatura.</label>'+
    '<button type="submit" class="btn primary">Salvar assinatura</button></form>',async function(fd){
      if(strokes<1)throw new Error('Solicite a assinatura no quadro.');
      const signer=String(fd.get('signer')||'').trim();
      if(!signer)throw new Error('Informe o responsável que assinou.');
      const base64=canvas.toDataURL('image/jpeg',0.85).split(',')[1];
      await api('/api/work-orders/'+orderId+'/attachments',{method:'POST',body:{
        requestId:newCommandId(),category:'OUTRO',caption:checklistPhotoCaption(checklistId,'assinatura',signer),
        originalName:'assinatura-checklist-'+checklistId+'.jpg',mimeType:'image/jpeg',base64:base64}});
      toast('Assinatura registrada');await viewWorkOrderChecklist(orderId,checklistId);
    });
  const canvas=$('#ckSignatureCanvas'),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle='#162b39';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
  let drawing=false,strokes=0;
  function point(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};}
  canvas.addEventListener('pointerdown',function(event){
    event.preventDefault();canvas.setPointerCapture(event.pointerId);drawing=true;
    const p=point(event);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.1,p.y+.1);ctx.stroke();strokes++;
  });
  canvas.addEventListener('pointermove',function(event){
    if(!drawing)return;event.preventDefault();const p=point(event);ctx.lineTo(p.x,p.y);ctx.stroke();
  });
  canvas.addEventListener('pointerup',function(){drawing=false;});
  canvas.addEventListener('pointercancel',function(){drawing=false;});
  $('#ckClearSignature').onclick=function(){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);strokes=0;};
}
async function checklistEmbeddedImage(file){
  if(!/^image\/(jpeg|png|webp)$/.test(String(file.mime_type||'')))throw new Error('Formato de imagem não permitido no relatório.');
  const bytes=await api('/api/attachments/'+file.id+'/file',{binary:true});
  return new Promise(function(resolve,reject){
    const reader=new FileReader();reader.onload=function(){resolve(String(reader.result));};
    reader.onerror=function(){reject(new Error('Não foi possível carregar uma das fotos.'));};
    reader.readAsDataURL(new Blob([bytes],{type:file.mime_type}));
  });
}
function checklistPrintHtml(os,company,checklist,evidence){
  const safe=esc,stamp=dt(checklist.created_at);
  const answers=(checklist.responses||[]).map(function(r){
    return '<tr><td>'+safe(r.label_snapshot)+'</td><td>'+safe(r.response.replaceAll('_',' '))+'</td><td>'+safe(r.note||'')+'</td></tr>';
  }).join('');
  const photos=evidence.filter(function(x){return x.kind==='foto';}).map(function(x){
    return '<figure><img src="'+x.src+'" alt="Foto do checklist"><figcaption>'+safe(x.note)+' · '+safe(dt(x.date))+'</figcaption></figure>';
  }).join('');
  const signs=evidence.filter(function(x){return x.kind==='assinatura';}).map(function(x){
    return '<div class="signature"><img src="'+x.src+'" alt="Assinatura coletada"><p>'+safe(x.note)+' · '+safe(dt(x.date))+'</p></div>';
  }).join('')||'<p>Assinatura do cliente não coletada.</p>';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">'+
    '<title>Checklist OS '+safe(os.os_number)+'</title><style>'+
    'body{font:14px system-ui,Arial,sans-serif;color:#172c35;max-width:900px;margin:auto;padding:30px}h1{font-size:24px;margin:0}h2{margin-top:26px;font-size:17px}header{border-bottom:3px solid #23637d;padding-bottom:12px}small,.muted{color:#536674}table{border-collapse:collapse;width:100%;margin-top:14px}th,td{padding:10px;border:1px solid #ccd7dc;text-align:left;vertical-align:top}th{background:#edf3f5}figure{break-inside:avoid;margin:0 0 18px}figure img{width:100%;max-height:410px;object-fit:contain;border:1px solid #ddd}.images{display:grid;grid-template-columns:1fr 1fr;gap:16px}.signature img{max-width:400px;width:100%;border:1px solid #aaa}.signature{break-inside:avoid}button{padding:12px;background:#23637d;color:#fff;border:0;border-radius:8px;cursor:pointer}@page{size:A4;margin:14mm}@media print{body{padding:0}button{display:none}.images{grid-template-columns:1fr 1fr}tr,figure{break-inside:avoid}}@media(max-width:600px){.images{grid-template-columns:1fr}}'+
    '</style></head><body><button onclick="window.print()">Imprimir / Salvar como PDF</button>'+
    '<header><h1>'+safe(company.name||'ArtiSys Oficina')+'</h1><p>'+safe(company.document||'')+' · '+safe(company.phone||'')+'</p>'+
    '<h2>'+safe(checklist.template_name_snapshot)+' — OS #'+safe(os.os_number)+'</h2></header>'+
    '<p><b>Cliente:</b> '+safe(os.customer_name||'—')+'<br><b>Veículo/equipamento:</b> '+safe([os.machine_brand,os.machine_model,os.machine_type].filter(Boolean).join(' ')||'—')+
    '<br><b>Registro:</b> '+safe(stamp)+'<br><b>Situação:</b> '+(checklist.completed_at?'Concluído':'Incompleto')+'</p>'+
    '<h2>Verificações</h2><table><thead><tr><th>Item</th><th>Situação</th><th>Observações</th></tr></thead><tbody>'+answers+'</tbody></table>'+
    '<h2>Fotografias vinculadas ao checklist</h2>'+(photos?'<div class="images">'+photos+'</div>':'<p>Nenhuma fotografia vinculada.</p>')+
    '<h2>Ciência do cliente</h2>'+signs+
    '<p class="muted">Assinatura desenhada em tela: registro visual, não assinatura digital certificada. Relatório gerado localmente pelo Oficina ArtiSys.</p></body></html>';
}
async function printChecklistAsPdf(orderId,checklistId){
  const win=window.open('about:blank','_blank');
  if(!win){toast('Permita a abertura de janelas para imprimir ou salvar o PDF.',true);return;}
  win.document.body.textContent='Preparando checklist, fotos e assinatura...';
  try{
    const data=await Promise.all([
      api('/api/work-orders/'+orderId),api('/api/company'),
      api('/api/checklists/'+checklistId),api('/api/work-orders/'+orderId+'/attachments')
    ]);
    const os=data[0],company=data[1],checklist=data[2];
    if(Number(checklist.work_order_id)!==Number(orderId))throw new Error('Checklist não pertence à OS.');
    const files=filesForChecklist(data[3],checklistId);
    const evidence=[];
    for(const file of files){
      const parts=String(file.caption).split(':');
      const kind=parts[2];
      if(kind!=='foto'&&kind!=='assinatura')continue;
      evidence.push({kind:kind,note:parts.slice(3).join(':')||'',date:file.created_at,src:await checklistEmbeddedImage(file)});
    }
    if(win.closed)return;
    win.document.open();win.document.write(checklistPrintHtml(os,company,checklist,evidence));win.document.close();
    win.focus();
  }catch(error){win.close();throw error;}
}
