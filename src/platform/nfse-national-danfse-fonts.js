// Fontes locais do sistema. Não distribua fontes proprietárias com o instalador.
// Windows: Arial/Arial Bold/Microsoft Sans Serif já presentes no sistema.
// Linux: fallback open source (Liberation Sans/DejaVu Sans) identificado como tal.
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';

const WIN=(process.env.WINDIR||'C:\\Windows');
const WINDOWS=join(WIN,'Fonts');
const FONT_DIRS=['/usr/share/fonts/truetype/liberation2','/usr/share/fonts/truetype/liberation',
 '/usr/share/fonts/truetype/dejavu','/usr/local/share/fonts'];
const files={
 content:[join(WINDOWS,'micross.ttf'),...FONT_DIRS.map(x=>join(x,'LiberationSans-Regular.ttf')),
  ...FONT_DIRS.map(x=>join(x,'DejaVuSans.ttf'))],
 label:[join(WINDOWS,'arialbd.ttf'),...FONT_DIRS.map(x=>join(x,'LiberationSans-Bold.ttf')),
  ...FONT_DIRS.map(x=>join(x,'DejaVuSans-Bold.ttf'))],
 arial:[join(WINDOWS,'arial.ttf'),...FONT_DIRS.map(x=>join(x,'LiberationSans-Regular.ttf')),
  ...FONT_DIRS.map(x=>join(x,'DejaVuSans.ttf'))]
};
const fail=m=>{throw Error(m);};
function fontFromPath(path){
 const bytes=readFileSync(path);
 if(bytes.length<3000||bytes.length>8*1024*1024)fail('Arquivo de fonte local inválido');
 const num=bytes.readUInt16BE(4);
 if(num<1||num>300)fail('Tabelas TrueType inválidas');
 const tables={};
 for(let i=0;i<num;i++){
  const at=12+i*16;if(at+16>bytes.length)fail('Font TTF truncada');
  const tag=bytes.toString('ascii',at,at+4),off=bytes.readUInt32BE(at+8),
    len=bytes.readUInt32BE(at+12);
  if(off+len>bytes.length)fail('Tabela TrueType fora do limite');
  tables[tag]={off,len};
 }
 for(const key of ['head','hhea','hmtx','cmap','maxp'])if(!tables[key])
   fail('TrueType local sem tabela '+key);
 const head=tables.head.off,hhea=tables.hhea.off,cmap=tables.cmap.off;
 const units=bytes.readUInt16BE(head+18),numH=bytes.readUInt16BE(hhea+34),
   glyphs=bytes.readUInt16BE(tables.maxp.off+4);
 if(units<16||units>16384||numH<1||glyphs<1)fail('Métricas TTF inválidas');
 let cmapOffset=-1,format=-1,rank=-1;
 const subtables=bytes.readUInt16BE(cmap+2);
 for(let i=0;i<subtables;i++){
  const at=cmap+4+i*8;
  const platform=bytes.readUInt16BE(at),encoding=bytes.readUInt16BE(at+2),
    off=cmap+bytes.readUInt32BE(at+4);
  if(off+2>bytes.length)continue;
  const fmt=bytes.readUInt16BE(off);
  const score=fmt===4&&platform===3&&encoding===1?4:
   fmt===4&&platform===0?3:fmt===12&&platform===3?2:0;
  if(score>rank){rank=score;format=fmt;cmapOffset=off;}
 }
 if(cmapOffset<0||![4,12].includes(format))fail('Cmap TrueType Unicode não suportada');
 function glyph(cp){
  if(format===12){
   const n=bytes.readUInt32BE(cmapOffset+12);
   let low=0,high=n-1;
   while(low<=high){const i=(low+high)>>>1,at=cmapOffset+16+i*12;
    const a=bytes.readUInt32BE(at),b=bytes.readUInt32BE(at+4);
    if(cp<a)high=i-1;else if(cp>b)low=i+1;else return bytes.readUInt32BE(at+8)+cp-a;}
   return 0;
  }
  const segments=bytes.readUInt16BE(cmapOffset+6)/2;
  const ends=cmapOffset+14,starts=ends+2*segments+2,
    deltas=starts+2*segments,ranges=deltas+2*segments;
  for(let i=0;i<segments;i++){
   if(cp>bytes.readUInt16BE(ends+i*2))continue;
   if(cp<bytes.readUInt16BE(starts+i*2))return 0;
   const delta=bytes.readInt16BE(deltas+i*2),range=bytes.readUInt16BE(ranges+i*2);
   if(!range)return (cp+delta)&0xffff;
   const at=ranges+i*2+range+2*(cp-bytes.readUInt16BE(starts+i*2));
   return at+2<=bytes.length?(bytes.readUInt16BE(at)+delta)&0xffff:0;
  }
  return 0;
 }
 const cp1252=[0x20ac,0x81,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,
  0x2c6,0x2030,0x160,0x2039,0x152,0x8d,0x17d,0x8f,
  0x90,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,
  0x2dc,0x2122,0x161,0x203a,0x153,0x9d,0x17e,0x178];
 const widths=[];
 for(let c=32;c<=255;c++){
  const cp=c>=128&&c<160?cp1252[c-128]:c;
  const id=glyph(cp),index=Math.min(Math.max(0,id),numH-1),
    at=tables.hmtx.off+index*4;
  widths.push(Math.max(1,Math.round(bytes.readUInt16BE(at)*1000/units)));
 }
 const scale=v=>Math.round(v*1000/units);
 const bbox=[bytes.readInt16BE(head+36),bytes.readInt16BE(head+38),
   bytes.readInt16BE(head+40),bytes.readInt16BE(head+42)].map(scale);
 const ascender=scale(bytes.readInt16BE(hhea+4)),
   descender=scale(bytes.readInt16BE(hhea+6));
 if(tables['OS/2']){
  const flags=bytes.readUInt16BE(tables['OS/2'].off+8);
  if(flags&2)fail('Font local impede embedding em PDF pela licença');
 }
 return {data:bytes,compressed:deflateSync(bytes,{level:9}),widths,bbox,
   ascender,descender,capHeight:Math.round(ascender*.9)};
}
export function loadDanfseFonts(){
 const result={};
 for(const [key,paths] of Object.entries(files)){
  const selected=paths.find(existsSync);
  if(!selected)fail('Fonte DANFSe local indisponível: '+key);
  result[key]={...fontFromPath(selected),
   exact:(key==='content'?selected.toLowerCase().endsWith('micross.ttf'):
    key==='label'?selected.toLowerCase().endsWith('arialbd.ttf'):
      selected.toLowerCase().endsWith('arial.ttf')),
   selected};
 }
 return result;
}
