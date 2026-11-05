// Roteamento fiscal canônico: não inferir autorização a partir de seleção do emissor.
export function selectManagedFiscalEngine({kind,certificateType}={}){
 if(!['NFE','NFCE','NFSE'].includes(kind))throw Error('Modelo fiscal inválido');
 return kind==='NFSE'&&certificateType==='A1'?'nacional':'acbr';
}
