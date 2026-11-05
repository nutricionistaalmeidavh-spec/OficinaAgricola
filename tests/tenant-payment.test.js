import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTenantPaymentConfigs,resolveTenantPaymentOptions} from '../src/platform/tenant-payment.js';

test('cada filial tem chave Pix distinta sem herdar outra unidade',()=>{
 const config=validateTenantPaymentConfigs({
  '1/1':{pixStatic:{pixKey:'filial1@example.com',merchantName:'OFICINA UM',merchantCity:'UBERABA'}},
  '1/2':{pixStatic:{pixKey:'filial2@example.com',merchantName:'OFICINA DOIS',merchantCity:'FRANCA'}}
 });
 const a=resolveTenantPaymentOptions({id:1,companyId:1},config);
 const b=resolveTenantPaymentOptions({id:2,companyId:1},config);
 const empty=resolveTenantPaymentOptions({id:3,companyId:1},config);
 assert.equal(a.pixStatic.pixKey,'filial1@example.com');
 assert.equal(b.pixStatic.pixKey,'filial2@example.com');
 assert.equal(empty.pixStatic,null);
});
test('rejeita configuração Pix compartilhada por engano e config não confiável',()=>{
 assert.throws(()=>validateTenantPaymentConfigs({'1/1':{pixStatic:{pixKey:'x',merchantName:'AAA',merchantCity:'UBERABA'}},'1/2':{pixStatic:{pixKey:'x',merchantName:'BBB',merchantCity:'FRANCA'}}}),/duplicada/i);
 assert.throws(()=>validateTenantPaymentConfigs({'../1':{}}),/unidade/i);
 assert.throws(()=>validateTenantPaymentConfigs({'1/1':{providers:{TEF:{token:'secret'}}}}),/não permitido/i);
});
