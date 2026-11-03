// Somente leitura de DTCs SAE J1979, resposta de serviço 03 (43). Não apaga códigos.
export function decodeDtcResponse(raw){
  const lines=String(raw??'').toUpperCase().replace(/\r/g,'\n').replace(/>/g,'\n').split('\n').map(x=>x.trim());
  const line=lines.find(x=>/(?:^|\s)43(?:\s|$)/.test(x)||/^43[0-9A-F]{4}/.test(x));
  if(!line)throw new Error('Resposta OBD-II inválida: não há dados do modo 03');
  const bytes=line.match(/\b[0-9A-F]{2}\b/g);
  let data;
  if(bytes&&bytes.includes('43'))data=bytes.slice(bytes.indexOf('43')+1);
  else{
    const rawHex=line.replace(/\s/g,'');
    if(!/^43(?:[0-9A-F]{2})+$/.test(rawHex))throw new Error('Resposta OBD-II inválida');
    data=rawHex.slice(2).match(/.{2}/g);
  }
  if(data.length%2)throw new Error('Resposta DTC truncada');
  const family=['P','C','B','U'],codes=[];
  for(let i=0;i<data.length;i+=2){
    const a=parseInt(data[i],16),b=parseInt(data[i+1],16);
    if(a===0&&b===0)continue;
    const dtc=family[(a>>6)&3]+((a>>4)&3).toString(16).toUpperCase()+
      (a&15).toString(16).toUpperCase()+((b>>4)&15).toString(16).toUpperCase()+
      (b&15).toString(16).toUpperCase();
    if(!codes.includes(dtc))codes.push(dtc);
    if(codes.length>100)throw new Error('Quantidade de DTCs inválida');
  }
  return codes;
}
