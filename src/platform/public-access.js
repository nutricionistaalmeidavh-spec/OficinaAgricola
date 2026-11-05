// Acesso externo opcional por proxy HTTPS próprio. O gateway continua em loopback.
export function normalizePublicOrigin(value=''){
  if(!value)return null;
  let url;try{url=new URL(value);}catch{throw Error('OFICINA_PUBLIC_ORIGIN inválida');}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||
    ['localhost','127.0.0.1','[::1]'].includes(url.hostname))
    throw Error('OFICINA_PUBLIC_ORIGIN exige origem HTTPS pública, sem caminho ou credenciais');
  return url.origin;
}
export function workshopRequestUrl(path,host,publicOrigin=null){
  if(typeof host!=='string'||/[\s\\/@]/.test(host))throw Error('Host inválido');
  const local=/^(?:localhost|127\.0\.0\.1|\[::1\]):[0-9]{2,5}$/.test(host);
  const external=publicOrigin&&host===new URL(publicOrigin).host;
  if(!local&&!external)throw Error('Host inválido');
  // Ignorar Forwarded/X-Forwarded-*; só a origem configurada é autorizada.
  const base=external?publicOrigin:'http://'+host;
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))throw Error('URL inválida');
  const url=new URL(path,base);
  if(url.origin!==base)throw Error('Origem inválida');
  return url;
}
