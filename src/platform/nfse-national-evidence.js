import {DOMParser} from '@xmldom/xmldom';

// Evidência local: somente depois de retorno AUTORIZADA do transporte oficial.
export function validNationalNfseReceipt({xml,key,protocol,cnpj,environment}={}){
 if(typeof xml!=='string'||xml.length<120||xml.length>1024*1024||
   /<!DOCTYPE|<!ENTITY/i.test(xml)||!/^\d{50}$/.test(key)||
   !/^\d{14}$/.test(cnpj)||protocol!==key)return false;
 let bad=false,root;
 try{root=new DOMParser({errorHandler:{warning:()=>{},error:()=>{bad=true},
   fatalError:()=>{bad=true}}}).parseFromString(xml,'application/xml')?.documentElement;}
 catch{return false}
 const local=node=>node?.localName||String(node?.nodeName||'').split(':').at(-1);
 const child=(node,n)=>{for(let x=node?.firstChild;x;x=x.nextSibling)
   if(x.nodeType===1&&local(x)===n)return x;return null};
 const value=(node,n)=>String(child(node,n)?.textContent||'').trim();
 const inf=child(root,'infNFSe'),details=child(child(inf,'DPS'),'infDPS');
 return !bad&&local(root)==='NFSe'&&inf?.getAttribute('Id')==='NFS'+key&&
   /^\d{1,13}$/.test(value(inf,'nNFSe'))&&
   /^DPS\d{42}$/.test(details?.getAttribute('Id')||'')&&
   value(details,'tpAmb')===(environment==='HOMOLOGACAO'?'2':'1')&&
   value(child(details,'prest'),'CNPJ')===cnpj;
}
