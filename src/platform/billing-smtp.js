import {connect} from 'node:tls';
import {once} from 'node:events';

const fail=message=>{throw new Error('SMTP: '+message);};
const email=value=>{
 const s=String(value??'').trim();
 if(s.length>254||!/^[^\s@<>:\r\n]+@[^\s@<>:\r\n]+\.[^\s@<>:\r\n]+$/.test(s))
  fail('endereço de e-mail inválido');
 return s;
};
const header=value=>{
 const v=String(value??'');
 if(v.length>300||/[\r\n\x00-\x1f]/.test(v))fail('cabeçalho inválido');
 return v;
};
function replyReader(socket){
 let buffer='',current=[],waiting=null,queued=[],failure=null;
 function settle(answer){
  if(waiting){const resolve=waiting;waiting=null;resolve(answer);}
  else queued.push(answer);
 }
 socket.on('data',chunk=>{
  buffer+=chunk.toString('utf8');
  if(buffer.length>65536){socket.destroy(Error('SMTP resposta excessiva'));return;}
  let end;
  while((end=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
   if(!/^[0-9]{3}[ -]/.test(line)){socket.destroy(Error('SMTP resposta inválida'));return;}
   current.push(line);
   if(line[3]===' '){
    settle({code:Number(line.slice(0,3)),lines:current});
    current=[];
   }
  }
 });
 socket.on('error',error=>{failure=error;if(waiting){const done=waiting;waiting=null;done({error});}});
 socket.on('close',()=>{failure??=Error('SMTP conexão encerrada');if(waiting){const done=waiting;waiting=null;done({error:failure});}});
 return async(expected,command)=>{
  if(failure&&!queued.length)throw failure;
  if(command!=null)socket.write(command+'\r\n');
  const result=queued.length?queued.shift():await new Promise(resolve=>{waiting=resolve;});
  if(result.error)throw result.error;
  if(!expected.includes(result.code))fail('resposta inesperada '+result.code);
  return result;
 };
}

/**
 * E-mail transacional via servidor SMTP TLS do próprio operador.
 * Não inclui conta externa, credenciais no repositório ou dependência NPM.
 * Somente SMTPS/TLS implícito; plaintext e STARTTLS downgrade são proibidos.
 */
export function createSecureSmtpReminderSender({host,port=465,from,user='',password=''}={}){
 const hostname=String(host??'').trim(),fromAddress=email(from);
 const n=Number(port);
 if(!hostname||hostname.length>253||/[^a-z0-9.:-]/i.test(hostname)||
    !Number.isInteger(n)||n<1||n>65535)fail('servidor inválido');
 if(Boolean(user)!==Boolean(password))fail('usuário e senha devem ser fornecidos juntos');
 if(/[\r\n\x00]/.test(String(user)+String(password)))fail('credenciais inválidas');
 return async function sendReminder({to,subject,body}={}){
  const recipient=email(to),title=header(subject);
  if(typeof body!=='string'||body.length>5000)fail('conteúdo inválido');
  const socket=connect({host:hostname,port:n,servername:hostname,
   minVersion:'TLSv1.2',rejectUnauthorized:true});
  socket.setTimeout(15000,()=>socket.destroy(new Error('SMTP timeout')));
  const response=replyReader(socket);
  try{
   await once(socket,'secureConnect');
   await response([220]);
   await response([250],'EHLO localhost');
   if(user){
    await response([235],'AUTH PLAIN '+Buffer.from('\0'+user+'\0'+password).toString('base64'));
   }
   await response([250],'MAIL FROM:<'+fromAddress+'>');
   await response([250],'RCPT TO:<'+recipient+'>');
   await response([354],'DATA');
   const subjectEncoded='=?UTF-8?B?'+Buffer.from(title,'utf8').toString('base64')+'?=';
   const encoded=Buffer.from(body,'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
   const payload=[
    'From: <'+fromAddress+'>','To: <'+recipient+'>','Subject: '+subjectEncoded,
    'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64','',encoded
   ].join('\r\n');
   await response([250],payload+'\r\n.');
   try{await response([221],'QUIT');}catch{/* Entrega já confirmada por 250. */}
  }finally{socket.destroy();}
 };
}
