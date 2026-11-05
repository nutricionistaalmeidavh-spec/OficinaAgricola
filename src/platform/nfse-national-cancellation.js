// Pedido de cancelamento 101101 conforme Anexo II SEFIN.
// Nenhuma autorização é inferida do envio: exige consulta ao evento oficial.
const digits=(v,len,name)=>{
 const value=String(v||'');
 if(!new RegExp('^\\d{'+len+'}$').test(value))throw Error(name+' inválido');
 return value;
};
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
 .replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function buildNationalCancelRequest({issuer,accessKey,reason,at=new Date()}={}){
 const key=digits(accessKey,50,'Chave NFS-e');
 const cnpj=digits(issuer?.cnpj,14,'CNPJ autor');
 if(!['HOMOLOGACAO','PRODUCAO'].includes(issuer?.environment))
   throw Error('Ambiente de cancelamento inválido');
 const why=String(reason||'').trim();
 if(why.length<15||why.length>255||/[\r\n<>]/.test(why))
   throw Error('Justificativa fiscal exige 15 a 255 caracteres, uma linha');
 if(!(at instanceof Date)||!Number.isFinite(at.getTime()))
   throw Error('Data do evento inválida');
 const time=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
  minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(at).replace(' ','T')+'-03:00';
 const id='PRE'+key+'101101001';
 const xml='<?xml version="1.0" encoding="UTF-8"?>'+
  '<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">'+
  '<infPedReg Id="'+id+'"><tpAmb>'+(issuer.environment==='PRODUCAO'?'1':'2')+
  '</tpAmb><verAplic>ARTISYS_OFICINA_1</verAplic><dhEvento>'+time+
  '</dhEvento><CNPJAutor>'+cnpj+'</CNPJAutor><chNFSe>'+key+
  '</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>9</cMotivo>'+
  '<xMotivo>'+escape(why)+'</xMotivo></e101101></infPedReg></pedRegEvento>';
 return {id,xml};
}
