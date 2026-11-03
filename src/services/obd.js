// Parser read-only SAE J1979 para modo 03. CAN contém byte de contagem de DTCs.
export function decodeDtcResponse(raw,{can=false}={}){
  const lines=String(raw??'').toUpperCase().replace(/\r/g,'\n').replace(/>/g,'\n').split('\n').map(x=>x.trim());
  const codes=[],family=['P','C','B','U'];
  let found=false;
  for(const line of lines){
    const bytes=line.match(/\b[0-9A-F]{2}\b/g);
    let data;
    if(bytes&&bytes.includes('43'))data=bytes.slice(bytes.indexOf('43')+1);
    else if(/^43(?:[0-9A-F]{2})+$/.test(line.replace(/\s/g,'')))
      data=line.replace(/\s/g,'').slice(2).match(/.{2}/g);
    else continue;
    found=true;
    if(can){
      if(!data.length)throw new Error('Resposta CAN sem contagem de DTCs');
      const count=parseInt(data.shift(),16);
      if(count>100||data.length<count*2)throw new Error('Resposta CAN truncada ou inválida');
      data=data.slice(0,count*2);
    }else if(data.length%2)throw new Error('Resposta DTC truncada');
    for(let i=0;i<data.length;i+=2){
      const a=parseInt(data[i],16),b=parseInt(data[i+1],16);
      if(a===0&&b===0)continue;
      const code=family[(a>>6)&3]+((a>>4)&3).toString(16).toUpperCase()+
        (a&15).toString(16).toUpperCase()+((b>>4)&15).toString(16).toUpperCase()+
        (b&15).toString(16).toUpperCase();
      if(!codes.includes(code))codes.push(code);
      if(codes.length>100)throw new Error('Quantidade de DTCs inválida');
    }
  }
  if(!found)throw new Error('Resposta OBD-II inválida: não há dados do modo 03');
  return codes;
}
