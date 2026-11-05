// Apenas agendamento local; sem serviços SaaS, sem rede obrigatória.
// O envio externo acontece somente se reminderSender tiver sido configurado.
export function startBillingReminderScheduler(billing,{intervalMs=6*60*60*1000,
 immediate=true,onError=()=>{}}={}){
 if(typeof billing?.dispatchReminders!=='function')throw Error('Serviço de lembretes indisponível');
 if(!Number.isSafeInteger(intervalMs)||intervalMs<60000)throw Error('Intervalo inválido');
 let active=true,running=false;
 const day=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',
   year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p=name=>parts.find(x=>x.type===name).value;
  return p('year')+'-'+p('month')+'-'+p('day');
 };
 async function tick(){
  if(!active||running)return;
  running=true;
  try{await billing.dispatchReminders({asOf:day(),daysAhead:3});}
  catch(error){onError(error);}
  finally{running=false;}
 }
 const timer=setInterval(tick,intervalMs);
 timer.unref?.();
 if(immediate)queueMicrotask(tick);
 return ()=>{active=false;clearInterval(timer);};
}
