// Motor de interpretação SAE J1979; sem dependência de hardware ou serviço remoto.
// Os adaptadores descrevem capacidades. Não existe driver J2534 pronto no núcleo.
const ADAPTERS=Object.freeze([
 {id:'ELM327_SERIAL',label:'ELM327 USB/serial',available:true,source:'REAL',transport:'WEB_SERIAL'},
 {id:'OBDLINK_STN_SERIAL',label:'OBDLink/STN USB serial (modo ELM)',available:true,source:'REAL',transport:'WEB_SERIAL'},
 {id:'SIMULATOR',label:'Simulador offline - somente testes',available:true,source:'SIMULATED',transport:'NONE'},
 {id:'J2534',label:'J2534 Pass-Thru - exige ponte e driver homologado',available:false,source:'REAL',transport:'BRIDGE'},
 {id:'J1939',label:'J1939 agrícola - depende de hardware e protocolo',available:false,source:'REAL',transport:'CAN'}
]);
export const listDiagnosticAdapters=()=>ADAPTERS.map(x=>({...x}));
const specs={
 '0104':{name:'Carga calculada',unit:'%',length:1,convert:a=>a[0]*100/255},
 '0105':{name:'Temperatura do líquido',unit:'°C',length:1,convert:a=>a[0]-40},
 '010C':{name:'RPM',unit:'rpm',length:2,convert:a=>(a[0]*256+a[1])/4},
 '010D':{name:'Velocidade',unit:'km/h',length:1,convert:a=>a[0]},
 '010F':{name:'Temperatura de admissão',unit:'°C',length:1,convert:a=>a[0]-40},
 '0110':{name:'Fluxo de ar (MAF)',unit:'g/s',length:2,convert:a=>(a[0]*256+a[1])/100},
 '0111':{name:'Posição do acelerador',unit:'%',length:1,convert:a=>a[0]*100/255},
 '012F':{name:'Nível combustível',unit:'%',length:1,convert:a=>a[0]*100/255},
 '0142':{name:'Tensão do módulo',unit:'V',length:2,convert:a=>(a[0]*256+a[1])/1000}
};
export const supportedDiagnosticPids=()=>Object.entries(specs).map(([pid,s])=>({pid,name:s.name,unit:s.unit}));

function extract(raw,header){
 const normalized=String(raw??'').toUpperCase().replace(/\r/g,'\n').replace(/>/g,'\n');
 if(normalized.length>6000)throw new Error('Resposta OBD-II extensa demais');
 if(/NO DATA|UNABLE TO CONNECT|CAN ERROR|STOPPED|BUS ERROR/.test(normalized))throw new Error('Resposta OBD-II indisponível');
 for(const line of normalized.split('\n')){
   const compact=line.replace(/\s/g,'');
   // Respostas com espaços e com cabeçalhos CAN opcionais (ex.: 7E8 04 41 ...).
   const pairs=line.match(/\b[0-9A-F]{2}\b/g)||[];
   let idx=pairs.indexOf(header);
   if(idx>=0)return pairs.slice(idx+1);
   const at=compact.indexOf(header);
   if(at>=0&&/^[0-9A-F]+$/.test(compact.slice(at))&&
      compact.slice(at).length%2===0)return compact.slice(at+2).match(/.{2}/g)||[];
 }
 throw new Error('Resposta OBD-II inválida: serviço '+header+' ausente');
}
export function decodePid(pid,raw,{freezeFrame=false}={}){
 const key=String(pid??'').toUpperCase();const spec=specs[key];
 if(!spec)throw new Error('PID não suportado: '+key);
 const header=freezeFrame?'42':'41',data=extract(raw,header);
 if(data[0]!==key.slice(2))throw new Error('Resposta PID inválida');
 const payload=freezeFrame?data.slice(2):data.slice(1);
 if(freezeFrame&&data[1]!=='00')throw new Error('Quadro congelado diferente de zero');
 if(payload.length<spec.length)throw new Error('Resposta PID truncada');
 const bytes=payload.slice(0,spec.length).map(x=>parseInt(x,16));
 if(bytes.some(x=>!Number.isFinite(x)))throw new Error('Resposta PID inválida');
 const value=Math.round(spec.convert(bytes)*100)/100;
 return {pid:key,name:spec.name,unit:spec.unit,value};
}
export function decodeDtcMode(mode,raw,{can=false}={}){
 const key=String(mode??'').toUpperCase(),header={'03':'43','07':'47','0A':'4A'}[key];
 if(!header)throw new Error('Modo de códigos não suportado');
 const family=['P','C','B','U'],data=extract(raw,header);
 const payload=[...data];
 if(can){
  if(!payload.length)throw new Error('Contagem CAN ausente');
  const count=parseInt(payload.shift(),16);
  if(count>100||payload.length<count*2)throw new Error('Resposta DTC truncada');
  payload.length=count*2;
 }else if(payload.length%2)throw new Error('Resposta DTC truncada');
 const codes=[];
 for(let i=0;i<payload.length;i+=2){
  const a=parseInt(payload[i],16),b=parseInt(payload[i+1],16);
  if(!Number.isInteger(a)||!Number.isInteger(b))throw new Error('Resposta DTC inválida');
  if(a===0&&b===0)continue;
  const code=family[(a>>6)&3]+((a>>4)&3).toString(16).toUpperCase()+
   (a&15).toString(16).toUpperCase()+((b>>4)&15).toString(16).toUpperCase()+
   (b&15).toString(16).toUpperCase();
  if(!codes.includes(code))codes.push(code);
  if(codes.length>100)throw new Error('Quantidade de códigos inválida');
 }
 return codes;
}
function parseVin(raw){
 const data=extract(raw,'49');
 if(data[0]!=='02')throw new Error('Resposta VIN inválida');
 const bytes=data.slice(1);
 // 49 02 [índice do quadro] [bytes ASCII]. Pode haver índice em cada quadro.
 const chars=bytes[0]==='01'?bytes.slice(1):bytes;
 const vin=chars.map(x=>String.fromCharCode(parseInt(x,16))).join('').replace(/\x00/g,'');
 if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('VIN incompleto ou inválido');
 return vin;
}
function record(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
}
export function parseDiagnosticCapture(input){
 if(!record(input))throw new Error('Captura inválida');
 const adapterId=String(input.adapterId||'ELM327_SERIAL').toUpperCase();
 const adapter=ADAPTERS.find(x=>x.id===adapterId);
 if(!adapter||!adapter.available)throw new Error('Adaptador indisponível no núcleo local');
 const source=String(input.source||adapter.source).toUpperCase();
 if(source!==adapter.source)throw new Error('Origem simulada inválida para leitura real');
 if(!record(input.responses)||!Object.keys(input.responses).length||Object.keys(input.responses).length>35)
   throw new Error('Respostas da captura inválidas');
 const size=JSON.stringify({responses:input.responses,samples:input.samples||[]}).length;
 if(size>30000)throw new Error('Captura excede limite de tamanho');
 const result={adapterId,source,protocol:String(input.protocol||'').slice(0,80),storedCodes:[],
  pendingCodes:[],permanentCodes:[],readings:{},freezeFrame:{},vin:null,samples:[],issues:[]};
 let count=0;
 const pushIssue=(key,error)=>{if(result.issues.length<30)result.issues.push(key+': '+error.message.slice(0,110))};
 for(const [rawKey,raw] of Object.entries(input.responses)){
   const key=rawKey.toUpperCase();
   if(typeof raw!=='string'||raw.length>6000)throw new Error('Resposta inválida: '+key);
   try{
    if(key==='03')result.storedCodes=decodeDtcMode('03',raw);
    else if(key==='07')result.pendingCodes=decodeDtcMode('07',raw);
    else if(key==='0A')result.permanentCodes=decodeDtcMode('0A',raw);
    else if(specs[key])result.readings[key]=decodePid(key,raw);
    else if(key.startsWith('02')&&specs['01'+key.slice(2)])result.freezeFrame[key]=
      decodePid('01'+key.slice(2),raw,{freezeFrame:true});
    else if(key==='0902')result.vin=parseVin(raw);
    else{pushIssue(key,new Error('Modo ou PID não suportado'));continue}
    count++;
   }catch(error){pushIssue(key,error)}
 }
 const samples=input.samples??[];
 if(!Array.isArray(samples)||samples.length>30)throw new Error('Série temporal inválida');
 let previous=-1;
 for(const item of samples){
  if(!record(item)||!record(item.responses)||!Number.isInteger(item.timeMs)||
     item.timeMs<0||item.timeMs>3600000||item.timeMs<previous)throw new Error('Amostra temporal inválida');
  previous=item.timeMs;
  const values={};
  for(const [key,raw] of Object.entries(item.responses)){
   if(!specs[key]||typeof raw!=='string')throw new Error('Sensor temporal inválido');
   try{values[key]=decodePid(key,raw).value}catch(error){pushIssue('Amostra '+key,error)}
  }
  if(Object.keys(values).length)result.samples.push({timeMs:item.timeMs,values});
 }
 if(!count&&result.samples.length===0)throw new Error('Nenhuma leitura OBD-II válida');
 return result;
}
