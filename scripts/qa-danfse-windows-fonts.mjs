import assert from 'node:assert/strict';
import {loadDanfseFonts} from '../src/platform/nfse-national-danfse-fonts.js';

if(process.platform!=='win32')throw Error('QA de tipografia normativa reservado ao Windows');
const fonts=loadDanfseFonts();
for(const [kind,font] of Object.entries(fonts)){
 assert.equal(font.exact,true,
  'Fonte original '+kind+' (Arial / Microsoft Sans Serif) ausente no Windows: '+font.selected);
 assert.ok(font.data.length>3000&&font.compressed.length>1000);
}
console.info('DANFSe NT 008: Arial, Arial Bold e Microsoft Sans Serif encontrados no Windows, embeddable e locais.');
