// Roteamento fiscal canônico: não inferir autorização a partir de seleção do emissor.
export function selectManagedFiscalEngine({kind,certificateType,providerName}={}){
 if(!['NFE','NFCE','NFSE'].includes(kind))throw Error('Modelo fiscal inválido');
 if(kind!=='NFSE')return 'acbr';
 if(providerName==='acbrlib-local')return 'acbr';
 if(providerName==='sefin-nacional-direta')return 'nacional';
 return certificateType==='A1'?'nacional':'acbr';
}
