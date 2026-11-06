// IBS/CBS NT004: sem inferência automática de tributação ou classe fiscal.
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

export function validateNationalRtc(rtc){
 if(!rtc||typeof rtc!=='object'||Array.isArray(rtc))
  throw Error('IBS/CBS exige declaração do responsável fiscal');
 const requireCode=(key,re)=>{
  const v=String(rtc[key]??'').trim();
  if(!re.test(v))throw Error('IBS/CBS: '+key+' inválido ou ausente');
  return v;
 };
 const finNFSe=requireCode('finNFSe',/^0$/);
 const cIndOp=requireCode('cIndOp',/^\d{6}$/);
 const indDest=requireCode('indDest',/^0$/);
 const CST=requireCode('CST',/^\d{3}$/);
 const cClassTrib=requireCode('cClassTrib',/^\d{6}$/);
 const indFinal=rtc.indFinal?requireCode('indFinal',/^[01]$/):undefined;
 return {finNFSe,cIndOp,indDest,CST,cClassTrib,...(indFinal?{indFinal}:{})};
}

export function attachNationalRtc(xml,values){
 const rtc=validateNationalRtc(values);
 if(typeof xml!=='string'||xml.length>512*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))
  throw Error('XML DPS inválido ou inseguro');
 let invalid=false,dom;
 try{dom=new DOMParser({errorHandler:{error:()=>{invalid=true},
  fatalError:()=>{invalid=true}}}).parseFromString(xml,'application/xml')}
 catch{throw Error('DPS malformada')}
 const root=dom.documentElement;
 const info=Array.from(root?.childNodes||[]).find(n=>n.nodeType===1&&n.localName==='infDPS');
 if(invalid||root?.localName!=='DPS'||!/^DPS\d{42}$/.test(info?.getAttribute('Id')||''))
  throw Error('DPS nacional não identificada');
 if(Array.from(info.childNodes).some(n=>n.localName==='IBSCBS'))
  throw Error('Grupo IBS/CBS já presente');
 const ns=root.namespaceURI||'http://www.sped.fazenda.gov.br/nfse';
 const add=(parent,key,val)=>{
  const node=dom.createElementNS(ns,key);
  if(val!==undefined)node.appendChild(dom.createTextNode(val));
  parent.appendChild(node);return node;
 };
 const block=add(info,'IBSCBS');
 add(block,'finNFSe',rtc.finNFSe);
 if(rtc.indFinal)add(block,'indFinal',rtc.indFinal);
 add(block,'cIndOp',rtc.cIndOp);
 add(block,'indDest',rtc.indDest);
 const group=add(add(add(block,'valores'),'trib'),'gIBSCBS');
 add(group,'CST',rtc.CST);add(group,'cClassTrib',rtc.cClassTrib);
 return new XMLSerializer().serializeToString(dom);
}
