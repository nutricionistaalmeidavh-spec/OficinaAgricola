import {readFileSync,statSync} from 'node:fs';
import {createAsaasBillingProvider,createAsaasHttpTransport} from './asaas-billing.js';

// Arquivo privado fora do repositório, opt-in por unidade, não exposto por API.
// Exemplo: {"1/2":{"environment":"sandbox","apiKey":"...",
//                     "customers":{"12":"cus_123"}}}
export function validateTenantAsaasConfigs(configs){
 if(!configs||typeof configs!=='object'||Array.isArray(configs))
  throw Error('Mapa Asaas inválido');
 const claimedKeys=new Set();
 for(const [unit,cfg] of Object.entries(configs)){
  if(!/^[1-9]\d*\/[1-9]\d*$/.test(unit)||
     !unit.split('/').every(v=>Number.isSafeInteger(Number(v))))
   throw Error('Empresa/unidade Asaas inválida');
  if(!cfg||typeof cfg!=='object'||Array.isArray(cfg)||
    Object.keys(cfg).some(k=>!['apiKey','environment','productionApproved','customers'].includes(k)))
   throw Error('Configuração de Asaas inválida');
  if(typeof cfg.apiKey!=='string'||cfg.apiKey.length<8)
   throw Error('Chave Asaas da unidade não configurada');
  if(claimedKeys.has(cfg.apiKey))throw Error('Chave Asaas duplicada entre unidades');
  claimedKeys.add(cfg.apiKey);
  if(!['sandbox','production'].includes(cfg.environment))
   throw Error('Ambiente Asaas deve ser escolhido explicitamente');
  if(cfg.environment==='production'&&cfg.productionApproved!==true)
   throw Error('Asaas produção exige liberação explícita');
  const customers=cfg.customers;
  if(!customers||typeof customers!=='object'||Array.isArray(customers))
   throw Error('Mapa de clientes Asaas obrigatório');
  for(const [id,ref] of Object.entries(customers))
   if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id))||
      typeof ref!=='string'||!/^cus_[A-Za-z0-9]+$/.test(ref))
    throw Error('Vínculo de cliente Asaas inválido');
 }
 return configs;
}
export function loadTenantAsaasConfigs(path){
 if(!path)return {};
 const info=statSync(path);
 if(!info.isFile()||info.size>65536)
  throw Error('Arquivo de configuração Asaas precisa ser regular e até 64 KiB');
 return validateTenantAsaasConfigs(JSON.parse(readFileSync(path,'utf8')));
}
export function createTenantAsaasBillingProviders(unit,configs={},port){
 validateTenantAsaasConfigs(configs);
 const id=Number(unit?.id),companyId=Number(unit?.companyId);
 if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(companyId)||companyId<1)
  throw Error('Unidade de cobrança Asaas inválida');
 const cfg=configs[companyId+'/'+id];
 if(!cfg)return {};
 if(!port||typeof port.first!=='function')throw Error('Porta de clientes canônicos obrigatória');
 const resolveCustomer=async workOrderId=>{
  const order=await port.first('SELECT customer_id FROM work_orders WHERE id=?',[Number(workOrderId)]);
  const customer=cfg.customers[String(order?.customer_id)]??null;
  if(!customer)throw Error('Cliente da OS não vinculado ao Asaas nesta unidade');
  return customer;
 };
 const transport=createAsaasHttpTransport({
  apiKey:cfg.apiKey,environment:cfg.environment,
  productionApproved:cfg.productionApproved===true
 });
 return Object.freeze({
  BOLETO:createAsaasBillingProvider({transport,resolveCustomer,method:'BOLETO'}),
  PAYMENT_LINK:createAsaasBillingProvider({transport,resolveCustomer,method:'PAYMENT_LINK'})
 });
}
