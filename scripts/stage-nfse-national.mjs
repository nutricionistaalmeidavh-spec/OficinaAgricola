import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
for(const pkg of ['@useinvio/nfse-sdk','@xmldom/xmldom','@xmldom/is-dom-node','node-forge','xml-crypto','xpath']){const target=resolve('build/nfse-national/node_modules',pkg);mkdirSync(resolve(target,'..'),{recursive:true});cpSync(resolve('node_modules',pkg),target,{recursive:true});}
