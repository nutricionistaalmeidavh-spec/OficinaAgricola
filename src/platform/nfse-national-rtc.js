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
