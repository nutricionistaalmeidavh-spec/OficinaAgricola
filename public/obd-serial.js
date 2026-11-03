// Web Serial em localhost/HTTPS. Comandos de consulta apenas; nunca envia modo 04.
async function readElm327StoredDtc(baudRate=38400){
  if(!navigator.serial?.requestPort)throw new Error('Web Serial indisponível. Use Electron ou Chromium no computador principal com adaptador USB/serial.');
  const port=await navigator.serial.requestPort();
  let reader,writer;
  try{
    await port.open({baudRate});
    reader=port.readable.getReader();
    writer=port.writable.getWriter();
    const encoder=new TextEncoder(),decoder=new TextDecoder();
    async function issue(command){
      await writer.write(encoder.encode(command+'\r'));
      let response='';
      const started=Date.now();
      while(!response.includes('>')){
        const remaining=7000-(Date.now()-started);
        if(remaining<=0)throw new Error('Sem resposta do adaptador ELM327');
        const received=await Promise.race([
          reader.read(),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tempo de resposta OBD-II excedido')),remaining))
        ]);
        if(received.done)throw new Error('Adaptador desconectado');
        response+=decoder.decode(received.value);
        if(response.length>4000)throw new Error('Resposta OBD-II extensa demais');
      }
      if(/\b(UNABLE TO CONNECT|BUS INIT|CAN ERROR|STOPPED)\b/i.test(response))
        throw new Error('Não foi possível comunicar com a ECU');
      return response;
    }
    await issue('ATZ');
    await issue('ATE0');
    await issue('ATL0');
    await issue('ATS1');
    await issue('ATH0');
    const protocol=(await issue('ATDP')).replace(/>/g,'').trim().slice(0,70);
    const rawResponse=await issue('03');
    return {rawResponse,protocol};
  }finally{
    try{await reader?.cancel()}catch{}
    try{reader?.releaseLock()}catch{}
    try{writer?.releaseLock()}catch{}
    try{await port.close()}catch{}
  }
}
