// Transportes opcionais e UI de diagnóstico. Nenhuma função escreve na ECU.
const diagnosticCommands=['03','07','0A','0101','0104','0105','010C','010D','010F','0110','0111','012F','0142','020C','0902'];
function diagnosticDemo(){
 return {adapterId:'SIMULATOR',source:'SIMULATED',protocol:'SIMULAÇÃO OFFLINE',
   responses:{'03':'43 01 33 00 00','07':'47 00 00','0A':'4A 00 00',
      '0101':'41 01 82 07 65 65','010C':'41 0C 1A F8','010D':'41 0D 28','0105':'41 05 72',
      '0104':'41 04 80','020C':'42 0C 00 12 C0'},
   samples:[{timeMs:0,responses:{'010C':'41 0C 1A F8'}},
            {timeMs:1500,responses:{'010C':'41 0C 1F 40'}},
            {timeMs:3000,responses:{'010C':'41 0C 19 00'}}]};
}
async function diagnosticReadSerial(adapterId,baudRate,sampleCount,progress){
 if(!['ELM327_SERIAL','OBDLINK_STN_SERIAL'].includes(adapterId))
   throw new Error('Este adaptador ainda não tem driver de leitura');
 if(!navigator.serial?.requestPort)throw new Error('Web Serial não disponível: utilize Electron ou Chromium no PC principal');
 if(![9600,38400,115200].includes(baudRate))throw new Error('Velocidade serial inválida');
 const port=await navigator.serial.requestPort();
 let reader,writer;
 try{
   await port.open({baudRate});
   reader=port.readable.getReader();writer=port.writable.getWriter();
   const decoder=new TextDecoder(),encoder=new TextEncoder();
   async function send(command,timeout=4500){
     if(!/^(?:AT(?:Z|E0|L0|S1|H0|DP)|03|07|0A|0[129][0-9A-F]{2})$/.test(command))
       throw new Error('Comando não autorizado para diagnóstico de leitura');
     await writer.write(encoder.encode(command+'\r'));
     let response='';
     const deadline=Date.now()+timeout;
     while(!response.includes('>')){
       const left=deadline-Date.now();
       if(left<=0)throw new Error('Tempo excedido na comunicação serial');
       let handle;
       const result=await Promise.race([
         reader.read(),
         new Promise((_,reject)=>{handle=setTimeout(()=>reject(new Error('Adaptador não respondeu')),left)})
       ]).finally(()=>clearTimeout(handle));
       if(result.done)throw new Error('Adaptador desconectado');
       response+=decoder.decode(result.value);
       if(response.length>6000)throw new Error('Resposta serial excede o limite');
     }
     if(/UNABLE TO CONNECT|CAN ERROR|BUS ERROR|STOPPED/i.test(response))
       throw new Error('ECU não responde ao adaptador');
     return response;
   }
   progress('Iniciando e identificando o adaptador...');
   for(const cmd of ['ATZ','ATE0','ATL0','ATS1','ATH0'])await send(cmd,cmd==='ATZ'?6000:4500);
   const protocol=(await send('ATDP')).replace(/>/g,'').trim().slice(-80);
   const responses={};
   for(const command of diagnosticCommands){
     progress('Consultando '+command+' (somente leitura)...');
     responses[command]=await send(command,6000);
   }
   const samples=[];
   const started=Date.now();
   for(let i=0;i<sampleCount;i++){
     progress('Capturando sensores: amostra '+(i+1)+' de '+sampleCount);
     const rpm=await send('010C',6000);
     samples.push({timeMs:Date.now()-started,responses:{'010C':rpm}});
   }
   return {adapterId,source:'REAL',protocol,responses,samples};
 }finally{
   try{await reader?.cancel()}catch{}
   try{reader?.releaseLock()}catch{}
   try{writer?.releaseLock()}catch{}
   try{await port.close()}catch{}
 }
}
async function diagnosticRunCapture(adapterId,baudRate,sampleCount,progress){
 if(adapterId==='SIMULATOR'){progress('Gerando dados simulados e rotulados...');return diagnosticDemo()}
 return diagnosticReadSerial(adapterId,baudRate,sampleCount,progress);
}
function diagnosticChart(samples,pid,label,unit){
 const rows=(samples||[]).filter(s=>Number.isFinite(s.values?.[pid]));
 if(rows.length<2)return '';
 const vals=rows.map(r=>r.values[pid]),minimum=Math.min(...vals),maximum=Math.max(...vals);
 const scale=(maximum-minimum)||1;
 const points=rows.map((r,i)=>{
   const x=20+340*(r.timeMs-rows[0].timeMs)/Math.max(1,rows.at(-1).timeMs-rows[0].timeMs);
   const y=95-65*(vals[i]-minimum)/scale;return x.toFixed(1)+','+y.toFixed(1)
 }).join(' ');
 return '<div><strong>'+esc(label)+'</strong> <small>('+esc(unit)+')</small>'+
  '<svg viewBox="0 0 380 115" role="img" aria-label="'+esc(label)+' ao longo do tempo" style="width:100%;max-height:140px;overflow:visible">'+
  '<line x1="20" y1="95" x2="360" y2="95" stroke="currentColor" opacity=".3"/>'+
  '<polyline fill="none" stroke="#15803d" stroke-width="3" stroke-linejoin="round" points="'+points+'"/>'+
  '<text x="20" y="111" font-size="10" fill="currentColor">'+minimum.toFixed(1)+'–'+maximum.toFixed(1)+' '+esc(unit)+'</text></svg></div>';
}
async function diagnosticDownload(machineId,scanId){
 const response=await fetch('/api/machines/'+machineId+'/obd-scans/'+scanId+'/pdf',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw new Error('Não foi possível gerar o PDF: '+response.status);
 const blob=await response.blob();
 if(blob.type!=='application/pdf')throw new Error('Resposta não é PDF');
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='ArtiSys-Diagnostico-'+scanId+'.pdf';document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function diagnosticDetailModal(machineId,scan){
 let details={};try{details=JSON.parse(scan.details_json||'{}')}catch{}
 const readings=Object.values(details.readings||{});
 const rows=(list,label)=>'<p><strong>'+label+':</strong> '+esc((list||[]).join(', ')||'Nenhum registrado')+'</p>';
 showModal('Diagnóstico #'+scan.id,
 '<div class="form-stack">'+
 '<p><strong>'+esc(scan.source==='SIMULATED'?'SIMULAÇÃO — não é diagnóstico real':'Leitura registrada')+'</strong> · '+esc(scan.created_at||'')+'</p>'+
 '<p class="muted">'+esc(scan.adapter_id||'ELM327_SERIAL')+' · '+esc(scan.protocol||'')+'</p>'+
 rows(JSON.parse(scan.codes_json||'[]'),'DTCs armazenados')+
 rows(details.pendingCodes,'DTCs pendentes')+rows(details.permanentCodes,'DTCs permanentes')+
 (details.readiness?'<p><strong>Prontidão:</strong> MIL '+(details.readiness.mil?'acesa':'apagada')+' · '+details.readiness.storedDtcCount+' DTC(s) reportados</p>':'')+
 (details.vin?'<p><strong>VIN ECU:</strong> '+esc(details.vin)+'</p>':'')+
 '<h3>Sensores</h3>'+(readings.length?readings.map(r=>'<div class="list-item"><strong>'+esc(r.name)+'</strong> '+esc(r.value)+' '+esc(r.unit)+'</div>').join(''):'<p class="muted">Sem sensores disponíveis.</p>')+
 diagnosticChart(details.samples,'010C','Rotação do motor','rpm')+
 diagnosticChart(details.samples,'0105','Temperatura do motor','°C')+
 ((details.issues||[]).length?'<h3>Leituras indisponíveis</h3><small>'+details.issues.map(esc).join(' · ')+'</small>':'')+
 (scan.notes?'<h3>Observações</h3><p>'+esc(scan.notes)+'</p>':'')+
 '<div class="action-row"><button id="diagPdf" class="btn primary">Baixar laudo PDF</button><button id="diagBack" class="btn">Voltar ao histórico</button></div>'+
 '<p class="muted">DTCs são evidências, não diagnóstico definitivo. Não há comandos de apagar falhas ou programar ECU.</p></div>');
 $('#diagPdf').onclick=async()=>{try{await diagnosticDownload(machineId,scan.id)}catch(e){toast(e.message,true)}};
 $('#diagBack').onclick=()=>machineHistoryModal(machineId);
}
async function diagnosticCaptureModal(machineId){
 const registry=await api('/api/diagnostics/adapters');
 const options=registry.map(d=>'<option value="'+esc(d.id)+'" '+(d.available?'':'disabled')+'>'+esc(d.label)+(d.available?'':' — indisponível')+'</option>').join('');
 showModal('Diagnóstico OBD-II multimarcas','<div class="form-stack">'+
 '<p>Selecione o equipamento. Os recursos disponíveis dependem da central eletrônica e do driver. Nenhum comando altera ou apaga dados da ECU.</p>'+
 '<label>Interface de diagnóstico<select id="diagAdapter">'+options+'</select></label>'+
 '<label>Velocidade serial<select id="diagBaud"><option value="38400">38400</option><option value="9600">9600</option><option value="115200">115200</option></select></label>'+
 '<label>Amostras de RPM<select id="diagSamples"><option value="3">3</option><option value="5">5</option><option value="10">10</option></select></label>'+
 '<label>OS vinculada (opcional)<input id="diagOs" type="number" min="1"></label>'+
 '<label>Observações técnicas<textarea id="diagNotes" maxlength="1500" placeholder="Descreva sintomas, testes e observações"></textarea></label>'+
 '<p class="muted">ELM327 e OBDLink/STN usam USB/serial. J2534 e J1939 aparecem como planejados, não disponíveis. Simulador: apenas para demonstrações.</p>'+
 '<div role="status" aria-live="polite" id="diagStatus"></div>'+
 '<button class="btn primary" id="diagStart" type="button">Conectar e registrar diagnóstico</button></div>');
 $('#diagStart').onclick=async()=>{
   const button=$('#diagStart'),status=$('#diagStatus');
   const adapterId=$('#diagAdapter').value,baud=Number($('#diagBaud').value),
     samples=Number($('#diagSamples').value),os=Number($('#diagOs').value),notes=$('#diagNotes').value;
   button.disabled=true;
   try{
     const result=await diagnosticRunCapture(adapterId,baud,samples,text=>status.textContent=text);
     status.textContent='Validando e armazenando resultados...';
     const scan=await api('/api/machines/'+machineId+'/obd-scans',{method:'POST',body:{
       ...result,notes,...(os?{workOrderId:os}:{}),requestId:newCommandId()}});
     toast(scan.source==='SIMULATED'?'Simulação identificada e registrada':'Leitura OBD-II registrada');
     diagnosticDetailModal(machineId,scan);
   }catch(error){status.textContent=error.message;toast(error.message,true);button.disabled=false}
 };
}
