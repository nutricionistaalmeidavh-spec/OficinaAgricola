import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {manifest,validateCatalog,installAsset,readInstalledAsset,listStatuses,assetUrl,resolveEntry} from '../src/services/model-library3d.js';

const fixture=()=> {
  const json=Buffer.from('{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}],"scene":0}', 'utf8');
  const pad=Buffer.alloc((4-json.length%4)%4,32);
  const body=Buffer.concat([json,pad]);
  const out=Buffer.alloc(20);
  out.write('glTF',0);
  out.writeUInt32LE(2,4);
  out.writeUInt32LE(20+body.length,8);
  out.writeUInt32LE(body.length,12);
  out.write('JSON',16);
  return Buffer.concat([out,body]);
};
const entry=(bin=fixture())=>({
  rank:1,id:'fiat-uno',brand:'Fiat',model:'Uno',status:'available',
  variants:{original:{
    ref:'0123456789abcdef0123456789abcdef01234567',
    path:'assets/fiat-uno.glb',
    sha256:createHash('sha256').update(bin).digest('hex'),
    bytes:bin.byteLength
  }}
});

test('Top 20: exatamente 20 entradas na ordem da frota, sem fingir Gol/Golf ou Siena/Classic',()=>{
  assert.equal(manifest.models.length,20);
  assert.equal(new Set(manifest.models.map(x=>x.id)).size,20);
  assert.deepEqual(manifest.models.map(x=>x.rank),Array.from({length:20},(_,i)=>i+1));
  assert.equal(manifest.models.filter(x=>x.status==='available').length,17);
  for(const name of ['Volkswagen Gol','Fiat Siena','Chevrolet Classic']){
    const x=manifest.models.find(y=>y.brand+' '+y.model===name);
    assert.equal(x.status,'blocked',name);
    assert.equal(Object.keys(x.variants).length,0);
  }
  assert.ok(manifest.models.some(x=>x.id==='chevrolet-corsa'&&x.notes.some(y=>/Sedan/i.test(y))));
  assert.ok(manifest.models.every(x=>x.review_status==='PENDENTE_REVISAO_VISUAL'));
  validateCatalog(manifest);
});

test('URL de download é fixa no repositório Artisys e valida caminho e SHA',()=>{
  const m={models:[entry()]};
  const link=assetUrl(resolveEntry(m,'fiat-uno','original'));
  assert.equal(link,'https://raw.githubusercontent.com/nutricionistaalmeidavh-spec/assetscarros3d/0123456789abcdef0123456789abcdef01234567/assets/fiat-uno.glb');
  for(const path of ['../../private.db','assets/foo.png','https://evil.com/file.glb']){
    const copy=structuredClone(m);
    copy.models[0].variants.original.path=path;
    assert.throws(()=>validateCatalog(copy));
  }
  assert.throws(()=>resolveEntry(m,'fiat-siena','original'),/indisponível|não encontrado/i);
});

test('download autorizado verifica SHA e guarda arquivo atomicamente para uso offline',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'artisys3d-'));
  try{
    const bin=fixture(), m={models:[entry(bin)]};
    let requested='';
    const request=async url=>{
      requested=String(url);
      return {ok:true,arrayBuffer:async()=>bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.length)};
    };
    const result=await installAsset(dir,'fiat-uno','original',{catalog:m,fetchImpl:request});
    assert.equal(result.installed,true);
    assert.match(requested,/raw\.githubusercontent\.com/);
    assert.deepEqual(readInstalledAsset(dir,'fiat-uno','original',{catalog:m}),bin);
    assert.equal(listStatuses(dir,{catalog:m})[0].installed.original,true);
    assert.equal((await installAsset(dir,'fiat-uno','original',{catalog:m,fetchImpl:()=>{throw Error('Não deveria baixar novamente')}})).installed,true);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('download modificado é rejeitado, sem deixar GLB corrompido instalado',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'artisys3d-'));
  try{
    const orig=fixture(),m={models:[entry(orig)]};
    const wrong=Buffer.from(orig);wrong[24]^=1;
    await assert.rejects(()=>installAsset(dir,'fiat-uno','original',{catalog:m,fetchImpl:async()=>({
      ok:true,arrayBuffer:async()=>wrong.buffer.slice(wrong.byteOffset,wrong.byteOffset+wrong.byteLength)
    })}),/SHA-256|integridade/);
    assert.throws(()=>readInstalledAsset(dir,'fiat-uno','original',{catalog:m}),/não instalado/i);
    assert.equal(listStatuses(dir,{catalog:m})[0].installed.original,false);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('cache corrompido não é servido como GLB e pode ser reinstalado',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'artisys3d-'));
  try{
    const bin=fixture(),m={models:[entry(bin)]},fetchImpl=async()=>({
      ok:true,arrayBuffer:async()=>bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)
    });
    await installAsset(dir,'fiat-uno','original',{catalog:m,fetchImpl});
    await writeFile(join(dir,'fiat-uno__original.glb'),Buffer.from('MALICIOUS'));
    assert.throws(()=>readInstalledAsset(dir,'fiat-uno','original',{catalog:m}),/integridade|GLB inválido/i);
    await installAsset(dir,'fiat-uno','original',{catalog:m,fetchImpl});
    assert.deepEqual(readInstalledAsset(dir,'fiat-uno','original',{catalog:m}),bin);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('interface tem o Top 20, carregamento de GLB real, OrbitControls e decodificação Meshopt offline',async()=>{
  const client=await readFile(new URL('../public/model-library.js',import.meta.url),'utf8');
  const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const sw=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
  const renderer=await readFile(new URL('../public/model-viewer.js',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const helper=await readFile(new URL('../public/model-library3d.js',import.meta.url),'utf8');
  assert.match(helper,/top20/);
  assert.match(client,/OficinaModel3D\.load/);
  assert.match(client,/data-model-detail/);
  assert.match(index,/src="\/model-library3d\.js"/);
  assert.match(renderer,/GLTFLoader/);
  assert.match(renderer,/OrbitControls/);
  assert.match(renderer,/MeshoptDecoder/);
  assert.match(renderer,/model\/gltf-binary|arrayBuffer|blob/i);
  assert.match(renderer,/\/vendor\/three\/three\.module\.js/);
  assert.match(server,/models3d.*install/);
  assert.match(server,/models3d\/file/);
  assert.match(sw,/model-viewer\.js/);
  assert.doesNotMatch(index,/https:\/\/(?:cdn|unpkg|jsdelivr)/i);
});

// Os GLBs usam EXT_meshopt_compression (WebAssembly). Uma política CSP de
// script-src 'self' sem wasm-unsafe-eval bloqueia o decoder no Chromium.
test('Política CSP mantém scripts locais e permite apenas WebAssembly Meshopt',async()=>{
  const session=await readFile(new URL('../src/platform/session-http.js',import.meta.url),'utf8');
  assert.match(session,/script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(session,/script-src[^;]+unsafe-eval(?!')/);
});
