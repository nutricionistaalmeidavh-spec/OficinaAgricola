import {DOMParser} from '@xmldom/xmldom';
export function nationalCancellationReceipt(xml,key,issuer){
 if(typeof xml!=='string'||xml.length>1048576||/<!DOCTYPE|<!ENTITY/i.test(xml))
  return null;
 let root;
 try{root=new DOMParser({errorHandler:{error:()=>{throw Error('xml')},
  fatalError:()=>{throw Error('xml')}}}).parseFromString(xml,'text/xml').documentElement}
 catch{return null}
 if(root?.localName!=='evento')return null;
 const info=Array.from(root.childNodes).find(x=>x.nodeType===1&&x.localName==='infEvento');
 const eventId='EVT'+key+'101101001';
 if(info?.getAttribute('Id')!==eventId)return null;
 const nodes=Array.from(info.getElementsByTagName('*'));
 const field=name=>nodes.filter(x=>x.localName===name).map(x=>String(x.textContent||'').trim());
 if(!field('chNFSe').includes(key)||!field('CNPJAutor').includes(issuer?.cnpj)||
  !field('tpAmb').includes(issuer?.environment==='PRODUCAO'?'1':'2')||
  !nodes.some(x=>x.localName==='e101101'))return null;
 return {eventId,xml};
}
