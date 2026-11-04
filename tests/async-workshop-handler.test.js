import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsyncWorkshopHandler} from '../src/platform/async-workshop-handler.js';

test('async backend HTTP denies access without service token and rejects unconfigured token',async()=>{
 assert.throws(()=>createAsyncWorkshopHandler({services:{},serviceToken:''}),/Token/);
 const handler=createAsyncWorkshopHandler({services:{createCustomer:async()=>({id:1})},serviceToken:'x'.repeat(32)});
 const denied=await handler(new Request('https://localhost/v1/customers',{method:'POST',body:JSON.stringify({name:'A'})}));
 assert.equal(denied.status,401);
 const wrong=await handler(new Request('https://localhost/v1/customers',{method:'POST',
  headers:{authorization:'Bearer '+'z'.repeat(32)},body:JSON.stringify({name:'A'})}));
 assert.equal(wrong.status,401);
});
test('async backend routes canonical operations only and provides no generic SQL execution',async()=>{
 const calls=[],services={
  async createCustomer(body){calls.push(['customer',body]);return {id:4,name:body.name};},
  async createMachine(body){calls.push(['machine',body]);return {id:5};},
  async createWorkOrder(body){calls.push(['order',body]);return {id:6};},
  async getWorkOrder(){return {id:6,status:'ENTRADA'};},
  async createPart(){return {id:7};},
  async postStockMovement(){return {id:8};},
  async receivePayment(){return {id:9};},
  async financeSummary(){return {receivedCents:0};}
 };
 const serviceToken='f'.repeat(40),handler=createAsyncWorkshopHandler({services,serviceToken});
 const request=(path,method='GET',body)=>handler(new Request('https://localhost'+path,{
  method,headers:{authorization:'Bearer '+serviceToken,
   ...(body?{'content-type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined
 }));
 let response=await request('/v1/customers','POST',{name:'Cliente'});
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{id:4,name:'Cliente'});
 response=await request('/v1/orders/6');assert.equal(response.status,200);
 assert.equal((await response.json()).status,'ENTRADA');
 assert.equal((await request('/v1/sql','POST',{sql:'DROP TABLE customers'})).status,404);
 assert.deepEqual(calls[0],['customer',{name:'Cliente'}]);
});
