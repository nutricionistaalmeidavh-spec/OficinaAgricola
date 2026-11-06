import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const flags=process.argv.slice(2);
if(flags.some(x=>x!=='--commercial'))throw Error('Opção de edição desconhecida');
const commercialActivation=flags.includes('--commercial');
mkdirSync('build',{recursive:true});
writeFileSync(join('build','oficina-edition.json'),
 JSON.stringify({product:'OFICINA',commercialActivation})+'\n',{encoding:'utf8'});
console.info('[edition] '+(commercialActivation?'comercial':'livre R$ 0'));
