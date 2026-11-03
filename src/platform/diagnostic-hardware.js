// Ponte local opcional para hardware J2534 e CAN/J1939. Sem rede externa.
// Os comandos são definidos pelo aplicativo e enviados ao worker Python por stdin;
// nenhum caminho de DLL ou comando de shell é aceito do navegador.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const CAN_INTERFACES=new Set(['socketcan','pcan','kvaser','vector','usb2can','ixxat','slcan','gs_usb','cantact']);
export function parseHardwareOptions(input={}){
 const adapterId=String(input.adapterId||'').toUpperCase();
 if(!['J2534','J1939'].includes(adapterId))throw new Error('Interface de diagnóstico inválida');
 if(adapterId==='J2534'){
  const driverKey=String(input.driverKey||'').trim();
  if(driverKey&&!/^[A-Za-z0-9 _.,()\-]{1,100}$/.test(driverKey))throw new Error('Identificador de driver J2534 inválido');
  const bitrate=Number(input.bitrate??500000);
  if(![250000,500000].includes(bitrate))throw new Error('Bitrate J2534 inválido');
  return {adapterId,driverKey,bitrate,mode:'obd-read-only'};
 }
 const canInterface=String(input.interface||'socketcan').trim().toLowerCase();
 const channel=String(input.channel||'can0').trim();
 const bitrate=Number(input.bitrate??250000);
 const durationSeconds=Number(input.durationSeconds??7);
 if(!CAN_INTERFACES.has(canInterface))throw new Error('Interface CAN não permitida');
 if(!/^[A-Za-z0-9_.:\/\-]{1,80}$/.test(channel))throw new Error('Canal CAN inválido');
 if(![250000,500000].includes(bitrate))throw new Error('Bitrate J1939 inválido');
 if(!Number.isInteger(durationSeconds)||durationSeconds<2||durationSeconds>15)
  throw new Error('Duração de captura fora do intervalo permitido');
 return {adapterId,interface:canInterface,channel,bitrate,durationSeconds,mode:'passive'};
}
function workerFile(){
 const path=fileURLToPath(new URL('./diagnostic-worker.py',import.meta.url));
 return path.includes('app.asar')?path.replace('app.asar','app.asar.unpacked'):path;
}
export function executeDiagnosticWorker(action,options={}, {python=process.env.DIAGNOSTIC_PYTHON||(process.platform==='win32'?'python':'python3'),timeoutMs=26000}={}){
 if(!['probe','capture'].includes(action))throw new Error('Operação de diagnóstico inválida');
 if(action==='capture')options=parseHardwareOptions(options);
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[workerFile()],{windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  let stdout='',stderr='',done=false;
  const fail=(message)=>{if(done)return;done=true;child.kill();reject(new Error(message))};
  const timeout=setTimeout(()=>fail('Leitura do equipamento excedeu o tempo limite'),timeoutMs);
  child.on('error',()=>fail('Python 3 não encontrado para ponte local de diagnóstico'));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>128*1024)fail('Captura do equipamento excede o limite de dados')});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1800)});
  child.on('close',code=>{
   clearTimeout(timeout);
   if(done)return;done=true;
   try{
    const result=JSON.parse(stdout);
    if(result?.ok!==true)throw new Error(String(result?.error||'Equipamento não respondeu').slice(0,280));
    if(code!==0)throw new Error('Falha no driver de diagnóstico');
    resolve(result.data);
   }catch(error){reject(new Error(stdout?error.message:'Driver de diagnóstico indisponível: '+stderr.slice(-260)))}
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify({action,options}));
 });
}
export function isLocalHardwareRequest(req){
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
}
