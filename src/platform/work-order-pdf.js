const money=(cents)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100).replace('R$ ','R$ ');
const date=(v)=>v?new Date(v).toLocaleString('pt-BR'):'—';

export const pdfSafe=(value)=>String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/\u00a0/g,' ').replace(/[^\x20-\xFF]/g,'?').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
export function wrap(value,max=82){
  const words=String(value??'').replace(/\s+/g,' ').trim().split(' ').filter(Boolean); const lines=[]; let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(next.length>max&&line){lines.push(line);line=word}else line=next} if(line)lines.push(line); return lines.length?lines:['—'];
}
export function buildPdf(pages){
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

export function renderWorkOrderPdf({os,company,customer,machine,quote,parts}){
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

