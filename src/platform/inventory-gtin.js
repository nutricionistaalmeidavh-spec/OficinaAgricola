// GTIN-8 / UPC-A (12) / EAN-13 / GTIN-14; validate check digit, preserve leading zeroes.
export function normalizeGtin(value){
 if(value===undefined)return undefined;
 if(value===null||String(value).trim()==='')return null;
 const code=String(value).trim().replace(/[\s-]/g,'');
 if(!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code))
  throw Object.assign(new Error('GTIN deve conter 8, 12, 13 ou 14 dígitos'),{status:400});
 let sum=0,weight=3;
 for(let i=code.length-2;i>=0;i--){sum+=Number(code[i])*weight;weight=weight===3?1:3;}
 if((10-sum%10)%10!==Number(code.at(-1)))
  throw Object.assign(new Error('Dígito verificador do GTIN inválido'),{status:400});
 return code;
}
