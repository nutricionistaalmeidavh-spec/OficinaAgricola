import { readFileSync, statSync } from 'node:fs';
import { createLocalFiscalProvider } from './local-fiscal-provider.js';
import { createAcbrLibFiscalProvider } from './acbrlib-fiscal-provider.js';

// Trusted server-side configuration only. No certificates, secrets or tokens
// are accepted from the HTTP request body or stored in the tenant registry.
const fail=message=>{throw new Error(message);};
const cnpjOf=value=>String(value??'').replace(/\D/g,'');
export function validateTenantFiscalConfigs(configs){
  if(!configs||typeof configs!=='object'||Array.isArray(configs))
    fail('Mapa de emissores fiscais inválido');
  const claimed=new Set();
  for(const [id,config] of Object.entries(configs)){
    if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id))||!config||typeof config!=='object'||Array.isArray(config))
      fail('ID de empresa fiscal inválido');
    const cnpj=cnpjOf(config.cnpj);
    if(cnpj.length!==14||/^(\d)\1+$/.test(cnpj))fail('CNPJ do emissor obrigatório e inválido para empresa '+id);
    if(claimed.has(cnpj))fail('CNPJ duplicado entre empresas no mapa fiscal');
    claimed.add(cnpj);
    // Configuração de canal NFS-e é local à empresa: sem fallback automático.
    if(config.nfseChannel!==undefined&&
        !['NACIONAL','MUNICIPAL'].includes(config.nfseChannel))
      fail('Canal NFS-e inválido: use NACIONAL ou MUNICIPAL');
    if(config.nfseChannel==='MUNICIPAL'&&
        !/^\d{7}$/.test(String(config.nfseMunicipalityIbge||'')))
      fail('Emissor municipal NFS-e exige município IBGE configurado');
    if(config.type==='sidecar'){
      let url;
      try{url=new URL(String(config.url||''));}catch{fail('Emissor local deve usar loopback HTTP');}
      if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||
        url.username||url.password||url.search||url.hash)
        fail('Emissor local deve usar loopback HTTP');
    }else if(config.type==='acbr'){
      if(!config.inputDir||(!config.nfeLib&&!config.nfseLib))
        fail('ACBr requer inputDir e pelo menos uma biblioteca local configurada');
      if(config.nfeLib&&!config.nfeConfig)fail('ACBr NFe requer configuração exclusiva');
      if(config.nfseLib&&!config.nfseConfig)fail('ACBr NFSe requer configuração exclusiva');
    }else fail('Tipo fiscal inválido: sidecar ou acbr');
  }
  return configs;
}
export function loadTenantFiscalConfigs(path){
  if(!path)return {};
  const info=statSync(path);
  if(!info.isFile()||info.size>65536)fail('Mapa fiscal precisa ser arquivo regular com no máximo 64 KiB');
  const content=JSON.parse(readFileSync(path,'utf8'));
  return validateTenantFiscalConfigs(content);
}
export function resolveTenantFiscalProvider({
  companyId,configs={},providers={
    sidecar:options=>createLocalFiscalProvider({url:options.url}),
    acbr:options=>createAcbrLibFiscalProvider({
      nfeLib:options.nfeLib||null,nfseLib:options.nfseLib||null,
      nfeConfig:options.nfeConfig||null,nfseConfig:options.nfseConfig||null,
      inputDir:options.inputDir,python:options.python||null,workerExe:options.workerExe||null
    })
  }
}){
  validateTenantFiscalConfigs(configs);
  const cfg=configs[String(companyId)];
  if(!cfg)return null;
  const underlying=providers[cfg.type]?.(cfg);
  if(!underlying||typeof underlying.transmit!=='function'||typeof underlying.consult!=='function')
    fail('Emissor fiscal específico da empresa não está disponível');
  const issuerCnpj=cnpjOf(cfg.cnpj);
  const ensureIssuer=({document,issuer}={})=>{
    const stored=issuer||JSON.parse(document?.issuer_snapshot_json||'{}');
    if(cnpjOf(stored.cnpj)!==issuerCnpj)
      fail('CNPJ fiscal não coincide com o emissor autorizado para a empresa');
  };
  return Object.freeze({
    name:underlying.name||('tenant-'+cfg.type),
    nfseChannel:cfg.nfseChannel||null,
    nfseMunicipalityIbge:cfg.nfseMunicipalityIbge||null,
    ...(typeof underlying.prepare==='function'?{prepare:args=>{ensureIssuer(args);return underlying.prepare(args);}}:{}),
    transmit:async args=>{ensureIssuer(args);return underlying.transmit(args);},
    consult:async args=>{ensureIssuer(args);return underlying.consult(args);},
    ...(typeof underlying.cancel==='function'?{
      cancel:async args=>{ensureIssuer(args);return underlying.cancel(args);}}:{}),
    ...(typeof underlying.consultCancellation==='function'?{
      consultCancellation:async args=>{ensureIssuer(args);return underlying.consultCancellation(args);}}:{}),
    ...(typeof underlying.prepareCancellation==='function'?{
      prepareCancellation:args=>{ensureIssuer(args);return underlying.prepareCancellation(args);}}:{}),
    ...(typeof underlying.printPdf==='function'?{
      printPdf:async args=>{ensureIssuer(args);return underlying.printPdf(args);}}:{})
  });
}
