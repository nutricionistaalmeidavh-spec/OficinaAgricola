#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {verifyTenantRecoverySet} from '../src/platform/tenant-recovery-set.js';

// Input lists only pre-staged archives. Inspection is read-only and NEVER
// copies archives into an active directory or performs a tenant cutover.
const configPath=process.argv[2];
if(!configPath){
 console.error('Uso: node scripts/verify-tenant-recovery-set.mjs ./recovery-set.json');
 process.exitCode=2;
}else{
 try{
  const config=JSON.parse(readFileSync(resolve(configPath),'utf8'));
  const result=verifyTenantRecoverySet(config);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(error){
  console.error('Recuperação multiempresa bloqueada:',error.message);
  process.exitCode=1;
 }
}
