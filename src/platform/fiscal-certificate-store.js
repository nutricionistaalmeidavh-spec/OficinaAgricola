// Certificado A1 local por unidade. Nenhum PFX ou senha entra no PostgreSQL,
// no Git ou no log. O arquivo é cifrado em repouso e o INI ACBr é efêmero.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {createSecureContext} from 'node:tls';
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync,mkdtempSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

const MAX_PFX=3*1024*1024;
function regular(path){
 if(!existsSync(path))return false;
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Arquivo fiscal local inseguro');
 return true;
}
function atomic(file,content){
 const tmp=file+'.new-'+randomBytes(8).toString('hex');
 try{
   writeFileSync(tmp,content,{flag:'wx',mode:0o600});
   renameSync(tmp,file);
 }finally{if(existsSync(tmp))rmSync(tmp,{force:true});}
}
export function createLocalFiscalCertificateStore({directory}={}){
 if(!directory||!isAbsolute(directory))throw Error('Diretório fiscal privado inválido');
 mkdirSync(directory,{recursive:true,mode:0o700});
 if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory())
   throw Error('Diretório fiscal privado inseguro');
 const secretFile=join(directory,'certificate.enc.json');
 const keyFile=join(directory,'vault.key');
 function key(){
   if(!regular(keyFile)){
     // Não substituir a chave de um certificado já existente: recuperação explícita.
     if(regular(secretFile))throw Error('Chave fiscal perdida; restaure o backup seguro');
     try{writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}
     catch(error){if(error.code!=='EEXIST')throw error;}
   }
   const content=readFileSync(keyFile);
   if(content.length!==32)throw Error('Chave do cofre fiscal inválida');
   return content;
 }
 function envelope(){
   if(!regular(secretFile))return null;
   const raw=readFileSync(secretFile,'utf8');
   if(raw.length>MAX_PFX*2)throw Error('Cofre fiscal excede limite');
   const result=JSON.parse(raw);
   if(result.version!==1||!/^[a-f0-9]{64}$/.test(result.fingerprint||''))
     throw Error('Cofre fiscal inválido');
   return result;
 }
 function status(){
   const saved=envelope();
   return saved?{configured:true,certificateType:'A1',
     fingerprint:saved.fingerprint.slice(0,12),configuredAt:saved.configuredAt}
     :{configured:false,certificateType:null};
 }
 function install({pfxBase64,password}={}){
   if(typeof pfxBase64!=='string'||pfxBase64.length>MAX_PFX*1.5||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(pfxBase64))
     throw Error('Selecione um certificado A1 PFX/P12 válido de até 3 MB');
   if(typeof password!=='string'||password.length>256||password.includes('\n')||
      password.includes('\r')||password.includes('\0'))
     throw Error('Senha do certificado inválida');
   const pfx=Buffer.from(pfxBase64,'base64');
   try{
     if(!pfx.length||pfx.length>MAX_PFX||pfx.toString('base64')!==pfxBase64)
       throw Error('Arquivo do certificado inválido');
     try{createSecureContext({pfx,passphrase:password});}
     catch{throw Error('PFX inválido ou senha incorreta');}
     const vaultKey=key(),iv=randomBytes(12);
     const cipher=createCipheriv('aes-256-gcm',vaultKey,iv);
     cipher.setAAD(Buffer.from('artisys-oficina-fiscal-a1-v1'));
     const encrypted=Buffer.concat([cipher.update(JSON.stringify({
       pfx:pfx.toString('base64'),password
     }),'utf8'),cipher.final()]);
     const saved={version:1,configuredAt:new Date().toISOString(),
       fingerprint:createHash('sha256').update(pfx).digest('hex'),
       iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
       cipherText:encrypted.toString('base64')};
     atomic(secretFile,JSON.stringify(saved));
     return status();
   }finally{pfx.fill(0);}
 }
 async function withConfig({kind,environment,uf},action){
   if(!['NFE','NFCE','NFSE'].includes(kind)||!['HOMOLOGACAO','PRODUCAO'].includes(environment)||
      !/^[A-Z]{2}$/.test(uf||'')||typeof action!=='function')
     throw Error('Identidade fiscal da emissão inválida');
   const saved=envelope();
   if(!saved)throw Error('Cadastre o certificado A1 da empresa antes da transmissão');
   const vaultKey=key();
   let content;
   try{
     const decipher=createDecipheriv('aes-256-gcm',vaultKey,Buffer.from(saved.iv,'base64'));
     decipher.setAAD(Buffer.from('artisys-oficina-fiscal-a1-v1'));
     decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
     content=JSON.parse(Buffer.concat([
       decipher.update(Buffer.from(saved.cipherText,'base64')),decipher.final()
     ]).toString('utf8'));
   }catch{throw Error('Cofre fiscal corrompido: não transmitir');}
   const run=mkdtempSync(join(directory,'run-'));
   try{
     const pfx=Buffer.from(content.pfx,'base64');
     const cert=join(run,'certificado.pfx'),config=join(run,kind==='NFSE'?'ACBrLibNFSe.ini':'ACBrLibNFe.ini');
     try{writeFileSync(cert,pfx,{flag:'wx',mode:0o600});}finally{pfx.fill(0);}
     const ini='[Principal]\nLogNivel=0\n\n[DFe]\nArquivoPFX='+cert+
       '\nSenha='+content.password+'\nUF='+uf+
       '\nVerificarValidade=1\nSSLCryptLib=1\nSSLHttpLib=3\nSSLXmlSignLib=1\n\n'+
       (kind==='NFSE'?'[NFSe]\n':'[NFe]\n')+
       'Ambiente='+(environment==='HOMOLOGACAO'?'1':'0')+'\n';
     writeFileSync(config,ini,{flag:'wx',mode:0o600});
     return await action(config);
   }finally{
     content=null;
     rmSync(run,{force:true,recursive:true,maxRetries:4,retryDelay:100});
   }
 }
 return Object.freeze({status,install,withConfig});
}
