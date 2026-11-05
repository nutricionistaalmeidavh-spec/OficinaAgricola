// Embalagem da marca oficial da NFS-e. Nunca obter recursos remotos durante a emissão.
import {existsSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync,deflateSync} from 'node:zlib';
const signature=Buffer.from('89504e470d0a1a0a','hex');
const error=message=>{throw Error(message);};
const directory=dirname(fileURLToPath(import.meta.url));
export const OFFICIAL_NFSE_LOGO_SOURCE='https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-da-nfs-e/Logo%20-%20NFS-e%20-%20Horizontal.png/@@images/image';

export function nationalDanfseLogo({logoPng}={}){
 if(Buffer.isBuffer(logoPng))return logoPng;
 const paths=[
  ...(process.resourcesPath?[join(process.resourcesPath,'nfse-national','danfse-logo.png')]:[]),
  join(directory,'danfse-logo.png'),
  join(directory,'..','..','build','nfse-national','danfse-logo.png')
 ];
 for(const path of paths)if(existsSync(path))return readFileSync(path);
 error('Logomarca NFS-e oficial ausente do pacote DANFSe: não substituir por imagem improvisada');
}
const paeth=(a,b,c)=>{
 const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);
 return da<=db&&da<=dc?a:db<=dc?b:c;
};
export function decodeNationalLogoPng(png){
 if(!Buffer.isBuffer(png)||png.length<64||png.length>3*1024*1024||
   !png.subarray(0,8).equals(signature))error('Logomarca oficial deve ser PNG válido');
 let offset=8,width=0,height=0,depth=0,type=0,interlace=0;
 const chunks=[],palette=[],transparency=[];
 while(offset+12<=png.length){
  const size=png.readUInt32BE(offset);
  const kind=png.toString('ascii',offset+4,offset+8);
  const begin=offset+8,end=begin+size;
  if(end+4>png.length)error('PNG DANFSe truncado');
  const data=png.subarray(begin,end);
  if(kind==='IHDR'){
   if(size!==13||width)error('Cabeçalho PNG NFS-e inválido');
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);
   depth=data[8];type=data[9];interlace=data[12];
   if(data[10]!==0||data[11]!==0)error('Formato PNG de marca não suportado');
  }else if(kind==='IDAT')chunks.push(data);
  else if(kind==='PLTE'){for(let i=0;i+2<data.length;i+=3)palette.push([data[i],data[i+1],data[i+2]]);}
  else if(kind==='tRNS')transparency.push(...data);
  offset=end+4;
  if(kind==='IEND')break;
 }
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
  width>5000||height>2000||width*height>3e6||depth!==8||interlace!==0||
  ![0,2,3,4,6].includes(type)||!chunks.length)
  error('PNG da marca NFS-e requer RGB/RGBA 8 bits sem entrelaçamento');
 const components={0:1,2:3,3:1,4:2,6:4}[type],stride=width*components,
   bytes=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});
 if(bytes.length!==(stride+1)*height)error('Linhas PNG da logomarca inválidas');
 const rgb=Buffer.alloc(width*height*3),line=Buffer.alloc(stride),before=Buffer.alloc(stride);
 let cursor=0;
 for(let y=0;y<height;y++){
  const filter=bytes[cursor++];
  if(filter>4)error('Filtro PNG da logomarca inválido');
  for(let x=0;x<stride;x++){
   const raw=bytes[cursor++],a=x>=components?line[x-components]:0,b=before[x],
     c=x>=components?before[x-components]:0;
   line[x]=(raw+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
  }
  for(let x=0;x<width;x++){
   let r=0,g=0,b=0,alpha=255,k=x*components;
   if(type===0){r=g=b=line[k];}
   else if(type===2){r=line[k];g=line[k+1];b=line[k+2];}
   else if(type===3){const color=palette[line[k]];if(!color)error('Paleta PNG NFS-e inválida');
     [r,g,b]=color;alpha=transparency[line[k]]??255;}
   else if(type===4){r=g=b=line[k];alpha=line[k+1];}
   else {r=line[k];g=line[k+1];b=line[k+2];alpha=line[k+3];}
   const out=(y*width+x)*3;
   rgb[out]=Math.round((r*alpha+255*(255-alpha))/255);
   rgb[out+1]=Math.round((g*alpha+255*(255-alpha))/255);
   rgb[out+2]=Math.round((b*alpha+255*(255-alpha))/255);
  }
  line.copy(before);
 }
 return {width,height,stream:deflateSync(rgb,{level:9})};
}
