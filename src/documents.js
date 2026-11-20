import {buildPdf,wrap,pdfSafe,renderWorkOrderPdf} from './platform/work-order-pdf.js';
import { getWorkOrder } from './services/work-orders.js';
import { getQuote } from './services/quotes.js';
import {renderDocumentFromData} from './platform/document-html.js';
export {renderDocumentFromData} from './platform/document-html.js';

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
  return renderDocumentFromData(documentData(db,workOrderId),kind);
}

export function renderPdfDocument(db,workOrderId,kind='work-order'){
  if(kind!=='work-order') throw new Error('PDF disponível apenas para ordem de serviço');
  return renderWorkOrderPdf(documentData(db,workOrderId));
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
