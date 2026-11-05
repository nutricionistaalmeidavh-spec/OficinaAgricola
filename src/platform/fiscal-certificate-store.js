// ACBr local: certificado A1 cifrado ou A3 via Windows Store.
// Não guardar PFX, senha ou PIN no banco de dados ou em logs.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {createSecureContext} from 'node:tls';
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync,mkdtempSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

const MAX_PFX=3*1024*1024;
const validSerial=s=>typeof s==='string'&&/^[A-F0-9]{6,80}$/.test(s);
const issuerDigits=s=>String(s??'').replace(/\D/g,'');
function regular(file){
 if(!existsSync(file))return false;
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Arquivo fiscal local inseguro');
 return true;
}
function atomic(file,content){
 const tmp=file+'.new-'+randomBytes(8).toString('hex');
 try{writeFileSync(tmp,content,{flag:'wx',mode:0o600});renameSync(tmp,file);}
 finally{if(existsSync(tmp))rmSync(tmp,{force:true});}
}
export function createLocalFiscalCertificateStore({directory}={}){
 if(!directory||!isAbsolute(directory))throw Error('Diretório fiscal privado inválido');
 mkdirSync(directory,{recursive:true,mode:0o700});
 if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory())
   throw Error('Diretório fiscal privado inseguro');
 const secretFile=join(directory,'certificate.enc.json');
 const keyFile=join(directory,'vault.key');
 const a3File=join(directory,'a3-selected.json');
 function key(){
   if(!regular(keyFile)){
     if(regular(secretFile))throw Error('Chave fiscal perdida; restaure o backup seguro');
     try{writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}
     catch(error){if(error.code!=='EEXIST')throw error;}
   }
   const value=readFileSync(keyFile);
   if(value.length!==32)throw Error('Chave do cofre fiscal inválida');
   return value;
 }
 function envelope(){
   if(!regular(secretFile))return null;
   const raw=readFileSync(secretFile,'utf8');
   if(raw.length>MAX_PFX*2)throw Error('Cofre fiscal excede limite');
   let result;
   try{result=JSON.parse(raw);}catch{throw Error('Cofre fiscal corrompido');}
   if(result.version!==1||!/^[a-f0-9]{64}$/.test(result.fingerprint||''))
     throw Error('Cofre fiscal inválido');
   return result;
 }
 function selectedA3(){
   if(!regular(a3File))return null;
   const raw=readFileSync(a3File,'utf8');
   if(raw.length>2048)throw Error('Vínculo A3 inválido');
   let selected;
   try{selected=JSON.parse(raw);}catch{throw Error('Vínculo A3 corrompido');}
   if(selected?.version!==1||!validSerial(selected.serial)||
       !/^[0-9]{14}$/.test(selected.issuerCnpj||''))
     throw Error('Vínculo A3 inválido');
   return selected;
 }
 function status(){
   const a3=selectedA3();
   if(a3)return {configured:true,certificateType:'A3',
     serialSuffix:a3.serial.slice(-8),configuredAt:a3.configuredAt};
   const saved=envelope();
   return saved?{configured:true,certificateType:'A1',
     fingerprint:saved.fingerprint.slice(0,12),configuredAt:saved.configuredAt}
     :{configured:false,certificateType:null};
 }
 function install({pfxBase64,password}={}){
   if(typeof pfxBase64!=='string'||pfxBase64.length>MAX_PFX*1.5||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(pfxBase64))
     throw Error('Selecione um certificado A1 PFX/P12 válido de até 3 MB');
   if(typeof password!=='string'||password.length>256||/[\r\n\x00]/.test(password))
     throw Error('Senha do certificado inválida');
   const pfx=Buffer.from(pfxBase64,'base64');
   try{
     if(!pfx.length||pfx.length>MAX_PFX||pfx.toString('base64')!==pfxBase64)
       throw Error('Arquivo do certificado inválido');
     try{createSecureContext({pfx,passphrase:password});}
     catch{throw Error('PFX inválido ou senha incorreta');}
     const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
     cipher.setAAD(Buffer.from('artisys-oficina-fiscal-a1-v1'));
     const encrypted=Buffer.concat([cipher.update(JSON.stringify({
       pfx:pfx.toString('base64'),password
     }),'utf8'),cipher.final()]);
     const saved={version:1,configuredAt:new Date().toISOString(),
       fingerprint:createHash('sha256').update(pfx).digest('hex'),
       iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
       cipherText:encrypted.toString('base64')};
     atomic(secretFile,JSON.stringify(saved));
     if(regular(a3File))rmSync(a3File,{force:true});
     return status();
   }finally{pfx.fill(0);}
 }
 function selectA3({serial,cnpj}={}){
   const normalized=String(serial??'').trim().toUpperCase();
   if(!validSerial(normalized))throw Error('Número de série A3 inválido');
   const issuerCnpj=issuerDigits(cnpj);
   if(!/^[0-9]{14}$/.test(issuerCnpj))throw Error('CNPJ da empresa para A3 inválido');
   atomic(a3File,JSON.stringify({version:1,serial:normalized,issuerCnpj,
     configuredAt:new Date().toISOString()}));
   return status();
 }
 function validate({kind,environment,uf},action){
   if(!['NFE','NFCE','NFSE'].includes(kind)||!['HOMOLOGACAO','PRODUCAO'].includes(environment)||
     !/^[A-Z]{2}$/.test(uf||'')||typeof action!=='function')
     throw Error('Identidade fiscal da emissão inválida');
 }
 async function tempConfig({kind,environment,uf,credentialLines},action){
   const run=mkdtempSync(join(directory,'run-'));
   try{
     const config=join(run,kind==='NFSE'?'ACBrLibNFSe.ini':'ACBrLibNFe.ini');
     const ini='[Principal]\nLogNivel=0\n\n[DFe]\n'+credentialLines.join('\n')+
       '\nUF='+uf+'\nVerificarValidade=1\n\n'+
       (kind==='NFSE'?'[NFSe]\n':'[NFe]\n')+
       'Ambiente='+(environment==='HOMOLOGACAO'?'1':'0')+'\n';
     writeFileSync(config,ini,{flag:'wx',mode:0o600});
     return await action(config,run);
   }finally{rmSync(run,{force:true,recursive:true,maxRetries:4,retryDelay:100});}
 }
 async function withDiscoveryConfig(options={},action){
   validate(options,action);
   // WinCrypt encontra certificados no Windows sem copiar a chave do cartão.
   return tempConfig({...options,credentialLines:[
     'SSLCryptLib=3','SSLHttpLib=2','SSLXmlSignLib=4'
   ]},action);
 }
 async function withConfig(options={},action){
   validate(options,action);
   const a3=selectedA3();
   if(a3){
     if(issuerDigits(options.cnpj)!==a3.issuerCnpj)
       throw Error('Certificado A3 não pertence ao CNPJ configurado');
     return tempConfig({...options,credentialLines:[
       'NumeroSerie='+a3.serial,'SSLCryptLib=3',
       'SSLHttpLib=2','SSLXmlSignLib=4'
     ]},action);
   }
   const saved=envelope();
   if(!saved)throw Error('Cadastre um certificado A1 ou selecione um A3');
   let content;
   try{
     const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(saved.iv,'base64'));
     decipher.setAAD(Buffer.from('artisys-oficina-fiscal-a1-v1'));
     decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
     content=JSON.parse(Buffer.concat([
       decipher.update(Buffer.from(saved.cipherText,'base64')),decipher.final()
     ]).toString('utf8'));
   }catch{throw Error('Cofre fiscal corrompido: não transmitir');}
   try{
     return await tempConfig({...options,credentialLines:[
       'SSLCryptLib=1','SSLHttpLib=3','SSLXmlSignLib=4'
     ]},async(config,run)=>{
       const pfx=Buffer.from(content.pfx,'base64'),cert=join(run,'certificado.pfx');
       try{writeFileSync(cert,pfx,{flag:'wx',mode:0o600});}finally{pfx.fill(0);}
       const ini=readFileSync(config,'utf8').replace('SSLCryptLib=1',
         'ArquivoPFX='+cert+'\nSenha='+content.password+'\nSSLCryptLib=1');
       writeFileSync(config,ini,{mode:0o600});
       return action(config);
     });
   }finally{content=null;}
 }
// mTLS da API Nacional: o PFX só existe em memória durante a requisição.
 // Não exportar este método em rotas HTTP nem persistir o PFX decifrado.
 async function withTlsIdentity({cnpj}={},action){
   if(!/^\d{14}$/.test(String(cnpj??''))||typeof action!=='function')
     throw Error('Identidade mTLS da empresa inválida');
   if(selectedA3())throw Error('API Nacional direta exige A1; A3 deve utilizar emissor ACBr compatível');
   const saved=envelope();
   if(!saved)throw Error('Certificado A1 local não configurado');
   let secret,pfx;
   try{
     const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(saved.iv,'base64'));
     decipher.setAAD(Buffer.from('artisys-oficina-fiscal-a1-v1'));
     decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
     secret=JSON.parse(Buffer.concat([
       decipher.update(Buffer.from(saved.cipherText,'base64')),decipher.final()
     ]).toString('utf8'));
     pfx=Buffer.from(secret.pfx,'base64');
     createSecureContext({pfx,passphrase:secret.password});
     return await action({pfx,passphrase:secret.password});
   }catch(error){
     if(error?.message?.includes('API Nacional')||error?.message?.includes('SEFIN'))
       throw error;
     throw Error('Falha ao utilizar certificado A1 local ou na conexão autenticada');
   }finally{
     if(pfx)pfx.fill(0);
     if(secret){secret.pfx='';secret.password='';}
   }
 }
 return Object.freeze({status,install,selectA3,
   activeSerial:()=>selectedA3()?.serial||null,withConfig,withDiscoveryConfig,withTlsIdentity});
}
