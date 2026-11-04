import {readFileSync,statSync} from 'node:fs';
import {generateStaticPix} from './payment-collection.js';

// Mapa explícito por empresa/unidade. Ex.: {"1/2":{"pixStatic":{...}}}.
// Nunca herdar automaticamente uma chave Pix de outra filial.
export function validateTenantPaymentConfigs(configs){
 if(!configs||typeof configs!=='object'||Array.isArray(configs))
  throw Error('Mapa de cobranças inválido');
 const keys=new Set();
 for(const [identifier,options] of Object.entries(configs)){
  if(!/^[1-9]\d*\/[1-9]\d*$/.test(identifier)||
     !identifier.split('/').every(v=>Number.isSafeInteger(Number(v))))
   throw Error('Identificador de empresa/unidade inválido');
  if(!options||typeof options!=='object'||Array.isArray(options)||
     Object.keys(options).some(key=>key!=='pixStatic'))
   throw Error('Provedor não permitido no mapa de cobranças; somente pixStatic é aceito');
  const pix=options.pixStatic;
  if(pix==null)continue;
  if(!pix||typeof pix!=='object'||Array.isArray(pix)||
     Object.keys(pix).some(key=>!['pixKey','merchantName','merchantCity'].includes(key)))
   throw Error('Configuração de Pix inválida');
  // Valida formato sem cobrar nem armazenar intenção.
  generateStaticPix({...pix,amountCents:1});
  const key=String(pix.pixKey).trim().toLowerCase();
  if(keys.has(key))throw Error('Chave Pix duplicada entre unidades; configure explicitamente o recebedor');
  keys.add(key);
 }
 return configs;
}
export function loadTenantPaymentConfigs(path){
 if(!path)return {};
 const stat=statSync(path);
 if(!stat.isFile()||stat.size>65536)
  throw Error('Mapa Pix deve ser arquivo regular de no máximo 64 KiB');
 return validateTenantPaymentConfigs(JSON.parse(readFileSync(path,'utf8')));
}
export function resolveTenantPaymentOptions(unit,configs={}){
 validateTenantPaymentConfigs(configs);
 if(!Number.isSafeInteger(Number(unit?.id))||!Number.isSafeInteger(Number(unit?.companyId))||
   Number(unit.id)<1||Number(unit.companyId)<1)
  throw Error('Unidade de cobrança inválida');
 const config=configs[String(unit.companyId)+'/'+String(unit.id)];
 return {pixStatic:config?.pixStatic?{...config.pixStatic}:null};
}
