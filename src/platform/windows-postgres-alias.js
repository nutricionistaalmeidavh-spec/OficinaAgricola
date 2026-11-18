// Map an accented Windows user profile to a temporary ASCII-only drive letter
// for native PostgreSQL tools that still use legacy Windows code-page APIs.
// All actual files stay under the original user's LocalAppData directory.
// Never modify ACLs, move databases, grant privilege or reset credentials.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat,realpath} from 'node:fs/promises';
import {win32} from 'node:path';

const run=promisify(execFile);
const canonical=p=>win32.normalize(String(p||'').replace(/^\\\\\?\\/,''))
 .replace(/[\\/]+$/,'').toLowerCase();
const driveRoot=d=>d+'\\';
const noOp=root=>Object.freeze({active:false,root,release:async()=>{}});

async function driveAvailable(drive){
 try{await stat(driveRoot(drive));return false;}
 catch(error){
   if(error?.code==='ENOENT')return true;
   throw error;
 }
}
async function subst(drive,root){
 await run('subst.exe',[drive,root],{windowsHide:true,timeout:15_000});
}
async function unsubst(drive){
 await run('subst.exe',[drive,'/D'],{windowsHide:true,timeout:15_000});
}
async function driveTarget(drive){
 try{return await realpath(driveRoot(drive));}
 catch(error){if(error?.code==='ENOENT')return null;throw error;}
}

/**
 * A private, non-destructive drive alias is used only for paths with characters
 * outside plain ASCII on Windows. The PostgreSQL process sees X:\\cluster and
 * X:\\bootstrap.pw while Node owns the original LocalAppData files. Avoid
 * reliance on 8.3 short filenames, which may be disabled on Windows volumes.
 */
export async function prepareWindowsPostgresAlias(root,{
 platform=process.platform,
 isDriveAvailable=driveAvailable,
 mount=subst,
 unmount=unsubst,
 mappedRoot=driveTarget
}={}){
 if(platform!=='win32'||!/[^ -~]/.test(root))return noOp(root);
 if(!win32.isAbsolute(root)||!/[A-Za-z]:[\\/]/.test(root))
   throw Error('Caminho Windows PostgreSQL deve ser absoluto para montar alias privado');
 const expected=canonical(root);
 // Windows maps SUBST drives per user session. Prefer to reuse a prior alias
 // left behind by a crash rather than allocating a new letter each time.
 for(const name of 'ZYXWVUTSRQP'){
   const drive=name+':';
   const target=await mappedRoot(drive);
   if(target&&canonical(target)===expected){
     let released=false;
     return Object.freeze({
       active:true,root:driveRoot(drive),
       async release(){
         if(released)return;
         if(canonical(await mappedRoot(drive))!==expected)return;
         await unmount(drive);
         released=true;
       }
     });
   }
 }
 for(const name of 'ZYXWVUTSRQP'){
   const drive=name+':';
   if(!(await isDriveAvailable(drive)))continue;
   await mount(drive,root);
   const target=await mappedRoot(drive);
   if(canonical(target)!==expected)
     throw Error('Alias PostgreSQL montado em diretório divergente: não usar ou remover');
   let released=false;
   return Object.freeze({
     active:true,root:driveRoot(drive),
     async release(){
       if(released)return;
       // Do not unmount an unrelated drive if another process changed it.
       if(canonical(await mappedRoot(drive))!==expected)return;
       await unmount(drive);
       released=true;
     }
   });
 }
 throw Error('Não existe letra de unidade Windows disponível para acessar o PostgreSQL com perfil Unicode. Nenhum dado foi alterado.');
}
