import { getWorkOrder } from './services/work-orders.js';
import { getQuote } from './services/quotes.js';

const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=(cents)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100).replace('R$ ','R$ ');
const date=(v)=>v?new Date(v).toLocaleString('pt-BR'):'—';

function documentData(db,workOrderId){
  const os=getWorkOrder(db,workOrderId); const company=db.prepare('SELECT * FROM company_settings WHERE id=1').get();
  const customer=JSON.parse(os.snapshot_customer); const machine=JSON.parse(os.snapshot_machine);
  let quote=null; try{quote=getQuote(db,workOrderId)}catch{}
  const receipts=db.prepare('SELECT * FROM receipts WHERE work_order_id=? AND reversed_at IS NULL ORDER BY received_at').all(workOrderId);
  const parts=db.prepare(`SELECT p.description,wop.quantity,wop.unit_price_cents FROM work_order_parts wop JOIN parts p ON p.id=wop.part_id WHERE wop.work_order_id=? AND wop.reversed_at IS NULL ORDER BY wop.id`).all(workOrderId);
  return {os,company,customer,machine,quote,receipts,parts};
}

export function renderDocument(db,workOrderId,kind='work-order'){
  const allowed=new Set(['quote','work-order','delivery','receipt']); if(!allowed.has(kind)) throw new Error('Documento inválido');
  const {os,company,customer,machine,quote,receipts}=documentData(db,workOrderId);
  const titles={quote:'Orçamento', 'work-order':'Ordem de Serviço', delivery:'Resumo de Entrega', receipt:'Recibo'};
  const rows=quote?.items?.map(i=>`<tr><td>${esc(i.description)}</td><td>${esc(i.kind.replaceAll('_',' '))}</td><td>${esc(i.quantity)}</td><td>${money(i.unit_price_cents)}</td><td>${money(i.total_cents)}</td></tr>`).join('')||'';
  const receiptRows=receipts.map(r=>`<tr><td>${date(r.received_at)}</td><td>${esc(r.method)}</td><td>${money(r.amount_cents)}</td></tr>`).join('');
  const body=kind==='receipt'
    ? `<h2>Recebimentos</h2><table><thead><tr><th>Data</th><th>Forma</th><th>Valor</th></tr></thead><tbody>${receiptRows||'<tr><td colspan="3">Nenhum recebimento registrado</td></tr>'}</tbody></table>`
    : `${kind!=='quote'?`<h2>Serviço</h2><p><strong>Problema relatado:</strong> ${esc(os.problem_reported)}</p><p><strong>Diagnóstico:</strong> ${esc(os.diagnosis)||'—'}</p>`:''}
      ${quote?`<h2>Itens</h2><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><p>Subtotal: ${money(quote.subtotal_cents)}</p><p>Desconto: ${money(quote.discount_cents)}</p><strong>Total: ${money(quote.total_cents)}</strong></div>`:''}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titles[kind]} OS ${os.os_number}</title><style>
    body{font-family:Arial,sans-serif;color:#1b2a22;max-width:900px;margin:32px auto;padding:0 24px} header{border-bottom:3px solid #075b3a;padding-bottom:16px;margin-bottom:24px} h1{color:#075b3a;margin:0} h2{margin-top:28px} .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px} table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #ddd;padding:9px;text-align:left}.totals{text-align:right;margin-top:16px}small{color:#667}</style></head><body>
    <header><h1>${esc(company.name)}</h1><div>${esc(company.document)} ${esc(company.phone)}</div><h2>${titles[kind]} — OS #${os.os_number}</h2></header>
    <section class="meta"><div><strong>Cliente</strong><br>${esc(customer.name)}<br>${esc(customer.document)}</div><div><strong>Equipamento</strong><br>${esc(machine.type)} ${esc(machine.brand)} ${esc(machine.model)}<br>Série: ${esc(machine.serialNumber)||'—'}</div><div><strong>Entrada</strong><br>${date(os.entered_at)}</div><div><strong>Status</strong><br>${esc(os.status)}</div></section>
    ${body}<footer><p><small>Documento gerado localmente pelo ArtiSys Oficina.</small></p></footer></body></html>`;
}

const pdfSafe=(value)=>String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/\u00a0/g,' ').replace(/[^\x20-\xFF]/g,'?').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
function wrap(value,max=82){
  const words=String(value??'').replace(/\s+/g,' ').trim().split(' ').filter(Boolean); const lines=[]; let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(next.length>max&&line){lines.push(line);line=word}else line=next} if(line)lines.push(line); return lines.length?lines:['—'];
}
function buildPdf(pages){
  const objects=[]; const pageRefs=[]; const pageCount=pages.length;
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
  objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  for(let i=0;i<pageCount;i++){const pageObj=5+i*2,contentObj=6+i*2;pageRefs.push(`${pageObj} 0 R`);const stream=pages[i];const len=Buffer.byteLength(stream,'latin1');objects[pageObj]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;objects[contentObj]=`<< /Length ${len} >>\nstream\n${stream}\nendstream`}
  objects[2]=`<< /Type /Pages /Count ${pageCount} /Kids [${pageRefs.join(' ')}] >>`;
  const chunks=[Buffer.from('%PDF-1.4\n%âãÏÓ\n','latin1')],offsets=[0]; let offset=chunks[0].length;
  for(let i=1;i<objects.length;i++){offsets[i]=offset;const chunk=Buffer.from(`${i} 0 obj\n${objects[i]}\nendobj\n`,'latin1');chunks.push(chunk);offset+=chunk.length}
  const xrefOffset=offset;let xref=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let i=1;i<objects.length;i++)xref+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;xref+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;chunks.push(Buffer.from(xref,'latin1'));return Buffer.concat(chunks);
}

export function renderPdfDocument(db,workOrderId,kind='work-order'){
  if(kind!=='work-order') throw new Error('PDF disponível apenas para ordem de serviço');
  const {os,company,customer,machine,quote,parts}=documentData(db,workOrderId);
  const pages=[]; let commands=[]; let y=800;
  const textLine=(value,{x=48,size=10,bold=false,gap=14}={})=>{if(y<65)newPage();commands.push(`BT /${bold?'F2':'F1'} ${size} Tf ${x} ${y} Td (${pdfSafe(value)}) Tj ET`);y-=gap};
  const rule=()=>{commands.push(`0.85 G 48 ${y} m 547 ${y} l S`);y-=14};
  const newPage=()=>{if(commands.length)pages.push(commands.join('\n'));commands=[];y=800;textLine(`${company.name} - OS #${os.os_number}`,{size:9,bold:true,gap:18})};
  const section=(title)=>{if(y<120)newPage();y-=4;textLine(title.toUpperCase(),{size:11,bold:true,gap:16});rule()};
  const field=(label,value)=>{for(const [i,line] of wrap(`${label}: ${value||'—'}`,88).entries())textLine(line,{x:i?62:48,size:10,gap:13})};

  textLine(company.name,{size:18,bold:true,gap:22});
  textLine([company.document,company.phone].filter(Boolean).join('  |  '),{size:9,gap:12});
  if(company.address)textLine(company.address,{size:9,gap:16});
  rule(); textLine(`ORDEM DE SERVIÇO #${os.os_number}`,{size:15,bold:true,gap:22});
  field('Entrada',date(os.entered_at)); field('Status',os.status.replaceAll('_',' ')); field('Prioridade',os.priority);
  section('Cliente'); field('Nome',customer.name); field('Documento',customer.document); field('Telefone',customer.phone); if(customer.address)field('Endereço',customer.address);
  section('Equipamento'); field('Equipamento',[machine.type,machine.brand,machine.model].filter(Boolean).join(' ')); field('Ano',machine.year); field('Série',machine.serialNumber); field('Identificação interna',machine.internalId);
  section('Serviço'); field('Problema relatado',os.problem_reported); field('Diagnóstico',os.diagnosis); field('Técnico',os.technician_name); field('Previsão de entrega',date(os.estimated_delivery));
  if(quote?.items?.length){section('Serviços e itens do orçamento');for(const item of quote.items){field(item.kind.replaceAll('_',' '),`${item.description} | ${item.quantity} x ${money(item.unit_price_cents)} = ${money(item.total_cents)}`)}textLine(`Subtotal: ${money(quote.subtotal_cents)}`,{bold:true});textLine(`Desconto: ${money(quote.discount_cents)}`);textLine(`TOTAL: ${money(quote.total_cents)}`,{size:12,bold:true,gap:18})}
  if(parts.length){section('Peças utilizadas');for(const p of parts)field('Peça',`${p.description} | Qtd. ${p.quantity}`)}
  section('Assinaturas');y-=18;textLine('________________________________________        ________________________________________',{size:9,gap:14});textLine('Cliente / responsável                                      Responsável técnico',{size:9,gap:18});
  rule();textLine('Documento gerado localmente pelo ArtiSys Oficina.',{size:8,gap:10});
  if(commands.length)pages.push(commands.join('\n'));return buildPdf(pages);
}

 // PDF gerado localmente; as medições são evidências registradas, não homologação OEM.
export function renderDiagnosticPdf(db,machineId,scanId){
  const scan=db.prepare(`SELECT s.*,m.brand,m.model,m.year,m.license_plate,m.vin,m.odometer_km,
     c.name customer_name,w.os_number FROM obd_scans s
     JOIN machines m ON m.id=s.machine_id
     JOIN customers c ON c.id=m.customer_id
     LEFT JOIN work_orders w ON w.id=s.work_order_id
     WHERE s.id=? AND s.machine_id=?`).get(scanId,machineId);
  if(!scan)throw new Error('Diagnóstico não encontrado para este veículo');
  const company=db.prepare('SELECT name,document,phone FROM company_settings WHERE id=1').get();
  let details={};try{details=JSON.parse(scan.details_json||'{}')}catch{}
  const pages=[];let lines=[],y=795;
  function newPage(){
    if(lines.length)pages.push(lines.join('\n'));
    lines=[];y=795;
  }
  function line(value,{bold=false,size=10,indent=48}={}){
    for(const piece of wrap(value,92)){
      if(y<62)newPage();
      lines.push(`BT /${bold?'F2':'F1'} ${size} Tf ${indent} ${y} Td (${pdfSafe(piece)}) Tj ET`);
      y-=size+6;
    }
  }
  const section=(label)=>{y-=6;line(label.toUpperCase(),{bold:true,size:11});};
  line(company.name,{bold:true,size:17});
  line('RELATÓRIO DE DIAGNÓSTICO ELETRÔNICO',{bold:true,size:13});
  if(scan.source==='SIMULATED')line('SIMULADO - NAO E UMA LEITURA REAL DO VEICULO',{bold:true,size:12});
  line('Cliente: '+scan.customer_name);
  line('Veículo: '+[scan.brand,scan.model,scan.year].filter(Boolean).join(' '));
  line('Placa: '+(scan.license_plate||'-')+' | VIN: '+(scan.vin||'-'));
  line('Data: '+date(scan.created_at)+' | OS: '+(scan.os_number||'sem vínculo'));
  line('Adaptador: '+scan.adapter_id+' | Fonte: '+scan.source);
  line('Protocolo informado: '+(scan.protocol||'não identificado'));
  section('Códigos de falha');
  line('Armazenados: '+(JSON.parse(scan.codes_json||'[]').join(', ')||'nenhum informado'));
  line('Pendentes: '+((details.pendingCodes||[]).join(', ')||'não disponíveis'));
  line('Permanentes: '+((details.permanentCodes||[]).join(', ')||'não disponíveis'));
  if(details.readiness)line('MIL: '+(details.readiness.mil?'ACESa':'APAGADA')+' | DTCs informados: '+details.readiness.storedDtcCount);
  if(details.vin)line('VIN informado pela ECU: '+details.vin);
  section('Sensores');
  const readings=Object.values(details.readings||{});
  if(!readings.length)line('Nenhuma leitura de sensor registrada');
  for(const r of readings)line(r.name+': '+r.value+' '+r.unit);
  if(Object.keys(details.freezeFrame||{}).length){
    section('Quadro congelado');
    for(const r of Object.values(details.freezeFrame))line(r.name+': '+r.value+' '+r.unit);
  }
  if((details.samples||[]).length){
    section('Amostras da série temporal');
    for(const sample of details.samples.slice(0,30)){
      line((sample.timeMs/1000).toFixed(1)+' s: '+
        Object.entries(sample.values).map(([k,v])=>k+'='+v).join(' | '));
    }
  }
  if((details.issues||[]).length){
    section('Leituras indisponíveis ou inválidas');
    for(const issue of details.issues)line(issue);
  }
  if(scan.notes){section('Observações do técnico');line(scan.notes);}
  section('Limitações');
  line('Códigos DTC não equivalem a diagnóstico definitivo. Consulte procedimentos e boletins do fabricante.');
  line('O laudo reflete apenas os modos e sensores acessíveis ao equipamento selecionado.');
  line('Documento local ArtiSys Oficina - sem serviços externos.');
  if(lines.length)pages.push(lines.join('\n'));
  return buildPdf(pages);
}
