import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness(fetchImpl=async()=>({status:200,ok:true,text:async()=>JSON.stringify({message:'ok'})})){
  const values=new Map();
  const writes=[];
  const node={set innerHTML(value){writes.push(value);},get innerHTML(){return writes.at(-1)||'';}};
  const document={
    querySelector(selector){if(selector==='#content')return node;return {textContent:'',classList:{add(){},remove(){},toggle(){}}};},
    querySelectorAll(){return [];},
  };
  const ctx=vm.createContext({
    document,window:{},localStorage:{getItem:()=>'',setItem(){},removeItem(){}},
    AbortController,DOMException,setTimeout,console,fetch:fetchImpl,
  });
  vm.runInContext(String.raw