import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveHttps, assertSameOrigin, issueBrowserCookie, hardenHttpResponse } from '../src/platform/session-http.js';

const request=(address,proto='https')=>({method:'POST',headers:{host:'oficina.example',origin:'https://oficina.example',cookie:'oficina_session=opaque',
  'x-forwarded-proto':proto},socket:{remoteAddress:address,encrypted:false}});
test('trusted loopback proxy accepts correct HTTPS origin and sets secure cookie',()=>{
 const prev=process.env.TRUST_LOOPBACK_PROXY;
 process.env.TRUST_LOOPBACK_PROXY='1';
 try{
   const req=request('127.0.0.1');
   assert.equal(effectiveHttps(req),true);
   assert.doesNotThrow(()=>assertSameOrigin(req));
   const headers={};const res={setHeader(k,v){headers[k]=v;}};
   issueBrowserCookie(res,req,'opaque');
   hardenHttpResponse(res,req);
   assert.match(headers['Set-Cookie'],/; Secure/);
   assert.ok(headers['Strict-Transport-Security']);
 }finally{if(prev===undefined)delete process.env.TRUST_LOOPBACK_PROXY;else process.env.TRUST_LOOPBACK_PROXY=prev;}
});
test('forged forwarded proto from remote address is never trusted',()=>{
 const prev=process.env.TRUST_LOOPBACK_PROXY;
 process.env.TRUST_LOOPBACK_PROXY='1';
 try{
   const remote=request('198.51.100.4');
   assert.equal(effectiveHttps(remote),false);
   assert.throws(()=>assertSameOrigin(remote),/Origem não autorizada/);
   const forged=request('127.0.0.1','http');
   assert.equal(effectiveHttps(forged),false);
   assert.throws(()=>assertSameOrigin(forged),/Origem não autorizada/);
 }finally{if(prev===undefined)delete process.env.TRUST_LOOPBACK_PROXY;else process.env.TRUST_LOOPBACK_PROXY=prev;}
});
