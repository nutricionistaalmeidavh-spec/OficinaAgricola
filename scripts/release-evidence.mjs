// Evidências de homologação: gate OFFLINE/opt-in, não substitui consulta à autoridade.
// Nenhum segredo, certificado, dados pessoais, VIN ou chaves fiscais no arquivo.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const scopes=['core','fiscal','diagnostics','printing','full'];
const requiredFields={
  'automated.ci':[],
  'automated.qa':[],
  'automated.windows':[],
  'automated.backup':[],
  'manual.disaster':['mode','restoreRef'],
  'manual.fiscal.nfe':['environment','authority','protocolRef'],
  'manual.fiscal.nfse':['environment','authority','protocolRef'],
  'manual.diagnostics':['mode','adapter','vehicleRef'],
  'manual.printing':['mode','printer','spoolRef'],
};

export function evaluateReleaseEvidence(evidence,scope='core'){
  const errors=[];
  if(!scopes.includes(scope))return {ok:false,errors:['Escopo inválido']};
  if(!evidence||typeof evidence!=='object')return {ok:false,errors:['Documento de evidência ausente']};
  if(!/^\d+\.\d+\.\d+/.test(String(evidence.version||'')))errors.push('Versão não identificada');
  if(!/^[a-f0-9]{40}$/i.test(String(evidence.commit||'')))errors.push('Commit de release inválido');
  const names=new Set();
  if(['core','full'].includes(scope)){
    for(const key of ['automated.ci','automated.qa','automated.windows','automated.backup','manual.disaster'])
      names.add(key);
  }
  if(['fiscal','full'].includes(scope)){
    names.add('manual.fiscal.nfe');
    names.add('manual.fiscal.nfse');
  }
  if(['diagnostics','full'].includes(scope))names.add('manual.diagnostics');
  if(['printing','full'].includes(scope))names.add('manual.printing');
  for(const key of names){
    const entry=key.split('.').reduce((v,k)=>v?.[k],evidence);
    if(!entry||entry.status!=='PASS'||!Number.isFinite(Date.parse(entry.observedAt))||
      typeof entry.evidenceRef!=='string'||entry.evidenceRef.trim().length<8){
      errors.push(key+': evidência PASS datada e identificada obrigatória');continue;
    }
    for(const field of requiredFields[key]){
      if(typeof entry[field]!=='string'||entry[field].trim().length<4)
        errors.push(key+': '+field+' obrigatório');
    }
    if((key==='manual.diagnostics'||key==='manual.printing'||key==='manual.disaster')&&entry.mode!=='REAL')
      errors.push(key+': teste SIMULATED não homologa hardware');
    if(key.startsWith('manual.fiscal.')&&
      (entry.environment!=='HOMOLOGACAO'||!['SEFAZ','MUNICIPIO','NACIONAL'].includes(entry.authority)))
      errors.push(key+': exige resposta real da autoridade em HOMOLOGACAO');
  }
  return {ok:errors.length===0,errors};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const path=process.argv[2],scope=process.argv[3]||'core';
  if(!path){console.error('Uso: node scripts/release-evidence.mjs <arquivo.json> [core|fiscal|diagnostics|printing|full]');process.exitCode=2;}
  else {
    try {
      const result=evaluateReleaseEvidence(JSON.parse(readFileSync(path,'utf8')),scope);
      if(!result.ok){for(const issue of result.errors)console.error('BLOQUEADO: '+issue);process.exitCode=1;}
      else console.log('Evidências declaradas completas para '+scope+'. Conferir autenticidade externamente antes da liberação.');
    }catch(error){console.error('BLOQUEADO: '+error.message);process.exitCode=1;}
  }
}
