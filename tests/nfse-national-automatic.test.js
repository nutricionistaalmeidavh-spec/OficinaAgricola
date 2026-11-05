import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareNationalDpsInput} from '../src/platform/nfse-national-automatic.js';
import {buildDpsFromJson} from '@useinvio/nfse-sdk';
const issuer={cnpj:'11222333000181',municipalityIbge:'3106200',taxRegime:'SIMPLES',environment:'HOMOLOGACAO'};
const snapshot=JSON.stringify({kind:'NFSE',originId:2,originType:'OS',
  nfseRoute:{channel:'NACIONAL',municipalityIbge:'3106200',taxRegime:'SIMPLES',competenceDate:'2026-11-05'},
  lines:[{sourceItemId:3,kind:'MAO_DE_OBRA',description:'Reparo no sistema hidraulico',
  subtotalCents:8000,discountCents:0,totalCents:8000}]});
const doc={id:54,kind:'NFSE',status:'RASCUNHO',snapshot_json:snapshot,
 snapshot_hash:createHash('sha256').update(snapshot).digest('hex'),
 amount_cents:8000,environment:'HOMOLOGACAO'};
const profile={kind:'SERVICE',name:'Manutencao mecanica',municipalityIbge:'3106200',id:'service1',
 serviceListCode:'14.01',nationalServiceCode:'140101',municipalServiceCode:'14.01',
 cnae:'4520001',issRate:'2.00',withheld:false};
const customer={document:'12345678909',name:'Cliente Teste',municipalityIbge:'3106200',
 zip:'30110010',street:'Rua Teste',number:'10',district:'Centro'};
const issuance={series:'101',number:'54',opSimpNac:'3',regEspTrib:'0',regApTribSN:'1',
 tribISSQN:'1',tpRetISSQN:'1',cstPisCofins:'07',percentFederal:'0.00',
 percentState:'0.00',percentMunicipal:'2.00',percentSimples:'2.00',issuedAt:'2026-11-05T12:00:00-03:00'};
const prep=(more={})=>prepareNationalDpsInput({document:doc,issuer,profile,customer,issuance,...more});
test('gera dados determinísticos da DPS a partir do snapshot canônico sem impostos inferidos',()=>{
 const result=prep();
 assert.equal(result.payload.prestador.cnpj,issuer.cnpj);
 assert.equal(result.payload.servico.cTribNac,'140101');
 assert.equal(result.payload.emissao.valores.vServ,'80.00');
 assert.equal(result.payload.emissao.dCompet,'2026-11-05');
 assert.equal(result.payload.emissao.tributacaoMunicipal.tribISSQN,'1');
 const xml=buildDpsFromJson(result.payload);
 assert.match(xml.xml,/<DPS/);
 assert.match(xml.xml,/Reparo no sistema hidraulico/);
 assert.match(xml.id,/^DPS\d{42}$/);
});
test('bloqueia venda mista, desconto não revisado, soma divergente e CNPJ de outro emitente',()=>{
 assert.throws(()=>prep({document:{...doc,amount_cents:9000}}),/valor|totais|diverg/i);
 assert.throws(()=>prep({document:{...doc,snapshot_hash:'a'.repeat(64)}}),/snapshot/i);
 assert.throws(()=>prep({profile:{...profile,municipalityIbge:'3550308'}}),/município/i);
 const discounted=JSON.stringify({...JSON.parse(snapshot),lines:[{sourceItemId:3,kind:'MAO_DE_OBRA',description:'Teste',subtotalCents:10000,discountCents:2000,totalCents:8000}]});
 assert.throws(()=>prep({document:{...doc,snapshot_json:discounted,snapshot_hash:createHash('sha256').update(discounted).digest('hex')}}),/desconto/i);
});
test('exige código nacional, dados do tomador e parâmetros ISS/IBS informados, sem defaults tributários',()=>{
 assert.throws(()=>prep({profile:{...profile,nationalServiceCode:undefined}}),/código nacional/i);
 assert.throws(()=>prep({customer:{...customer,document:'',name:'X'}}),/CPF|CNPJ|tomador/i);
 assert.throws(()=>prep({issuance:{...issuance,tribISSQN:undefined}}),/ISS/i);
 assert.throws(()=>prep({issuance:{...issuance,series:''}}),/série/i);
});
test('número da DPS deriva da decisão explícita do operador, nunca da data ou máquina',()=>{
 const a=prep(),b=prep();
 assert.deepEqual(a,b);
 assert.notEqual(prep({issuance:{...issuance,series:'102'}}).idDps,a.idDps);
});
