import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {assertFiscalIssuerUf} from './fiscal-uf.js';

const validStates=new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const validRegimes=new Set(['MEI','SIMPLES','NORMAL']);
const clean=v=>String(v??'').trim();
const digits=v=>clean(v).replace(/\D/g,'');
const now=()=>new Date().toISOString();
const nextId=()=>randomBytes(6).readUIntBE(0,6);
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n;};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const sha=value=>createHash('sha256').update(value).digest('hex');
function validCnpj(input){
 const cnpj=digits(input);
 if(cnpj.length!==14||/^(\d)\1+$/.test(cnpj))return false;
 for(const size of [12,13]){
   const weights=size===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
   const sum=weights.reduce((s,w,i)=>s+w*Number(cnpj[i]),0);
   const rest=sum%11;
   if(Number(cnpj[size])!==(rest<2?0:11-rest))return false;
 }
 return true;
}
const changed=result=>Number(result?.changes??result?.meta?.changes??0);
export function createAsyncWorkshopFiscal(port,{provider=null}={}){
 if(!['sqlite','d1','postgres'].includes(port?.engine))fail('Adaptador SQL inválido');
 async function getFiscalSettings(){
   const row=await port.first('SELECT * FROM fiscal_settings WHERE id=1');
   if(!row)fail('Configuração fiscal inexistente',503);
   return row;
 }
 async function setFiscalSettings(input={}){
   const old=await getFiscalSettings();
   const cnpj=input.issuerCnpj===undefined?old.issuer_cnpj:digits(input.issuerCnpj),
     uf=input.issuerUf===undefined?old.issuer_uf:clean(input.issuerUf).toUpperCase(),
     ibge=input.municipalityIbge===undefined?old.municipality_ibge:digits(input.municipalityIbge),
     regime=input.taxRegime===undefined?old.tax_regime:clean(input.taxRegime).toUpperCase(),
     state=input.stateRegistration===undefined?old.state_registration:clean(input.stateRegistration).slice(0,40),
     municipality=input.municipalRegistration===undefined?old.municipal_registration:clean(input.municipalRegistration).slice(0,40),
     environment=input.environment===undefined?old.environment:clean(input.environment).toUpperCase(),
     // A transmissão em homologação é habilitada pelo cadastro válido, sem toggle manual.
     enabled=validCnpj(cnpj)&&validStates.has(uf)&&/^\d{7}$/.test(ibge)&&validRegimes.has(regime),
     production=input.productionConfirmed===undefined?Boolean(old.production_confirmed):input.productionConfirmed===true;
   if(cnpj&&!validCnpj(cnpj))fail('CNPJ do emissor inválido');
   if(uf&&!validStates.has(uf))fail('UF do emissor inválida');
   if(ibge&&!/^\d{7}$/.test(ibge))fail('Município IBGE inválido');
   if(regime&&!validRegimes.has(regime))fail('Regime tributário inválido');
   if(!['HOMOLOGACAO','PRODUCAO'].includes(environment))fail('Ambiente fiscal inválido');
   if(input.enabled===true&&!enabled)
     fail('Complete CNPJ, UF, município IBGE e regime tributário');
   if(enabled)assertFiscalIssuerUf({uf,municipalityIbge:ibge});
   if(enabled&&environment==='PRODUCAO'&&!production)
     fail('Produção exige confirmação administrativa explícita');
   await port.run(`UPDATE fiscal_settings SET enabled=?,environment=?,issuer_cnpj=?,
     issuer_uf=?,municipality_ibge=?,tax_regime=?,state_registration=?,
     municipal_registration=?,production_confirmed=?,updated_at=? WHERE id=1`,[
     enabled?1:0,environment,cnpj,uf,ibge,regime,state,municipality,production?1:0,now()
   ]);
   return getFiscalSettings();
 }
 async function getFiscalOnboardingStatus(){
   const settings=await getFiscalSettings();
   return {environment:settings.environment,
     companyConfigured:Boolean(settings.enabled),
     issuerCnpj:settings.issuer_cnpj||'',
     certificate:typeof provider?.certificateStatus==='function'
       ?provider.certificateStatus():{configured:false},
     providerReady:Boolean(provider&&typeof provider.transmit==='function'),
     // Não atribuir validade fiscal ao simples status do servidor SEFAZ.
     authorizationVerified:false,
     taxProfileVerified:false};
 }
 async function installFiscalCertificate(input={}){
   const settings=await getFiscalSettings();
   if(!settings.enabled)fail('Cadastre CNPJ, UF, município IBGE e regime tributário antes do certificado',409);
   if(!provider||typeof provider.installCertificate!=='function')
     fail('Instalação de certificado requer ACBr local embarcado',503);
   return provider.installCertificate({
     pfxBase64:input.pfxBase64,password:input.password
   });
 }
 async function installFiscalCsc(input={}){
   const settings=await getFiscalSettings();
   if(!settings.enabled)fail('Cadastre os dados fiscais da empresa antes do CSC',409);
   if(!provider||typeof provider.installCsc!=='function')
     fail('CSC NFC-e requer ACBr embarcado desta unidade',503);
   return provider.installCsc({idCsc:input.idCsc,csc:input.csc});
 }
 async function diagnoseFiscal(){
   const settings=await getFiscalSettings();
   if(!settings.enabled)fail('Cadastro fiscal incompleto',409);
   if(!provider||typeof provider.diagnose!=='function')
     fail('Diagnóstico fiscal requer ACBr local configurado',503);
   return provider.diagnose({settings});
 }
 async function saveFiscalTaxReview(documentId,input={}){
   const document=await getFiscalDocument(documentId);
   if(document.kind!=='NFE'||document.status!=='RASCUNHO')
     fail('Somente rascunho NF-e permite revisar tributação',409);
   const settings=await getFiscalSettings();
   if(!settings.enabled||document.environment!==settings.environment)
     fail('Cadastro fiscal/ambiente divergente do documento',409);
   if(!provider||typeof provider.saveTaxReview!=='function')
     fail('Revisão tributária exige ACBr local configurado',503);
   const result=await provider.saveTaxReview({
     document,issuer:issuerFrom(settings),sections:input.sections
   });
   await port.run(`INSERT INTO fiscal_events(
     id,document_id,event_type,details_json,created_at
   ) VALUES(?,?,?, ?,?)`,[
     nextId(),document.id,'REVISAO_TRIBUTARIA',
     JSON.stringify({reviewHash:result.reviewHash,environment:document.environment}),now()
   ]);
   return {reviewed:true,reviewHash:result.reviewHash};
 }
 async function getFiscalDocument(documentId){
   const row=await port.first('SELECT * FROM fiscal_documents WHERE id=?',[id(documentId)]);
   if(!row)fail('Documento fiscal não encontrado',404);
   return row;
 }
 async function getFiscalEvents(documentId){
   await getFiscalDocument(documentId);
   return port.all('SELECT * FROM fiscal_events WHERE document_id=? ORDER BY id',[id(documentId)]);
 }
 async function listFiscalDocuments({status='',limit=100}={}){
   const n=Math.max(1,Math.min(500,Number(limit)||100));
   return port.all(`SELECT * FROM fiscal_documents
     WHERE (?='' OR status=?) ORDER BY id DESC LIMIT ?`,[clean(status),clean(status),n]);
 }
 function issuerFrom(settings){
   return {cnpj:settings.issuer_cnpj,uf:settings.issuer_uf,
     municipalityIbge:settings.municipality_ibge,taxRegime:settings.tax_regime,
     stateRegistration:settings.state_registration,
     municipalRegistration:settings.municipal_registration,
     environment:settings.environment
   };
 }
 function assertReady(settings,document){
   if(!settings.enabled)fail('Fiscal desabilitado: configure a empresa antes de transmitir',409);
   if(document.environment!==settings.environment)fail('Rascunho fiscal de outro ambiente',409);
   if(settings.environment==='PRODUCAO'&&!settings.production_confirmed)
     fail('Produção fiscal não confirmada',409);
   if(!validCnpj(settings.issuer_cnpj)||!validStates.has(settings.issuer_uf)||
     !/^\d{7}$/.test(settings.municipality_ibge)||!validRegimes.has(settings.tax_regime))
     fail('Configuração fiscal incompleta',409);
   assertFiscalIssuerUf({uf:settings.issuer_uf,municipalityIbge:settings.municipality_ibge});
   return issuerFrom(settings);
 }
 async function applyResult(documentId,attemptId,result,providerName){
   const doc=await getFiscalDocument(documentId);
   if(doc.status!=='INDETERMINADO'||doc.attempt_id!==attemptId)
     fail('Conflito de tentativa fiscal; exija conciliação manual',409);
   const status=clean(result?.status).toUpperCase();
   let fields,params,eventType,eventDetails;
   if(status==='AUTORIZADA'){
     const env=clean(result.environment).toUpperCase();
     if(doc.environment!==env)fail('Ambiente fiscal da resposta divergente',409);
     const key=clean(result.accessKey),protocol=clean(result.protocol),xml=clean(result.xml);
     const number=clean(result.number),series=clean(result.series);
     if(!key||!protocol||!xml.startsWith('<')||!/^[1-9][0-9]*$/.test(number)||!series)
       fail('Resposta fiscal sem comprovantes completos; consulte antes de reenviar',409);
     eventType=env==='HOMOLOGACAO'?'AUTORIZADA_HOMOLOGACAO':'AUTORIZADA';
     fields=`status=?,access_key=?,protocol=?,fiscal_number=?,fiscal_series=?,
       authorized_xml=?,response_json=?,last_error='',authorized_at=?,updated_at=?`;
     params=[eventType,key,protocol,number,series,xml,
       JSON.stringify({status:eventType,provider:providerName,environment:env}),now(),now()];
     eventDetails={protocol,accessKey:key,number,series,provider:providerName,environment:env};
   }else if(status==='REJEITADA'){
     eventType='REJEITADA';
     const message=clean(result.message).slice(0,500),code=clean(result.code).slice(0,60);
     fields=`status='REJEITADA',response_json=?,last_error=?,updated_at=?`;
     params=[JSON.stringify({status,code,message}),message,now()];
     eventDetails={code,message};
   }else{
     eventType='INDETERMINADO';
     fields='last_error=?,updated_at=?';
     params=['Resposta fiscal inconclusiva; concilie antes de reenviar',now()];
     eventDetails={message:'Resposta fiscal inconclusiva'};
   }
   const update={sql:`UPDATE fiscal_documents SET ${fields}
     WHERE id=? AND status='INDETERMINADO' AND attempt_id=?`,
     params:[...params,id(documentId),attemptId]};
   const evt={sql:`INSERT INTO fiscal_events(id,document_id,event_type,details_json,created_at)
     VALUES(?,?,?,?,?)`,params:[nextId(),id(documentId),eventType,JSON.stringify(eventDetails),now()]};
   if(port.engine==='d1'){
     const res=await port.batch([update,{
       sql:evt.sql.replace('VALUES(?,?,?,?,?)',
         'SELECT ?,?,?,?,? WHERE changes()=1'),params:evt.params
     }]);
     if(changed(res[0])!==1)fail('Tentativa fiscal já processada',409);
   }else await port.transaction(async tx=>{
     const res=await tx.run(update.sql,update.params);
     if(changed(res)!==1)fail('Tentativa fiscal já processada',409);
     await tx.run(evt.sql,evt.params);
   });
   return getFiscalDocument(documentId);
 }
 async function uncertain(documentId,message){
   const event={sql:`INSERT INTO fiscal_events(
     id,document_id,event_type,details_json,created_at
   ) VALUES(?,?,'FALHA_INDETERMINADA',?,?)`,params:[
     nextId(),id(documentId),JSON.stringify({message:clean(message).slice(0,500)}),now()
   ]};
   const update={sql:`UPDATE fiscal_documents SET last_error=?,updated_at=?
     WHERE id=? AND status='INDETERMINADO'`,params:[clean(message).slice(0,500),now(),id(documentId)]};
   if(port.engine==='d1')await port.batch([update,event]);
   else await port.transaction(async tx=>{await tx.run(update.sql,update.params);await tx.run(event.sql,event.params);});
 }
 async function submitFiscalDocument(documentId){
   const doc=await getFiscalDocument(documentId);
   if(doc.status==='INDETERMINADO')fail('Documento fiscal indeterminado: concilie antes de reenviar',409);
   if(doc.status!=='RASCUNHO')fail('Documento fiscal não permite nova transmissão',409);
   if(!provider||typeof provider.transmit!=='function')
     fail('Emissor fiscal não configurado; nenhuma nota enviada',503);
   const issuer=assertReady(await getFiscalSettings(),doc);
   if(typeof provider.prepare==='function')await provider.prepare({document:doc,issuer});
   const attemptId=randomUUID(),providerName=clean(provider.name)||'local',at=now();
   const update={sql:`UPDATE fiscal_documents SET
     status='INDETERMINADO',provider_name=?,attempt_id=?,issuer_snapshot_json=?,updated_at=?
     WHERE id=? AND status='RASCUNHO'`,params:[
     providerName,attemptId,JSON.stringify(issuer),at,doc.id
   ]};
   const event={sql:`INSERT INTO fiscal_events(
     id,document_id,event_type,details_json,created_at
   ) VALUES(?,?,?,?,?)`,params:[
     nextId(),doc.id,'TRANSMISSAO_INICIADA',JSON.stringify({
       attemptId,provider:providerName,issuerSnapshotHash:sha(JSON.stringify(issuer))
     }),at
   ]};
   if(port.engine==='d1'){
     const rows=await port.batch([update,{
       sql:event.sql.replace('VALUES(?,?,?,?,?)','SELECT ?,?,?,?,? WHERE changes()=1'),
       params:event.params
     }]);
     if(changed(rows[0])!==1)fail('Documento fiscal já em processamento',409);
   }else await port.transaction(async tx=>{
     if(changed(await tx.run(update.sql,update.params))!==1)
       fail('Documento fiscal já em processamento',409);
     await tx.run(event.sql,event.params);
   });
   try{
     const result=await provider.transmit({
       document:await getFiscalDocument(doc.id),attemptId
     });
     return await applyResult(doc.id,attemptId,result,providerName);
   }catch(error){
     await uncertain(doc.id,error?.message||error);
     throw error;
   }
 }
 async function getFiscalPdf(documentId){
   const doc=await getFiscalDocument(documentId);
   if(!['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(doc.status))
     fail('Somente documento autorizado e não cancelado permite DANFE/DANFSe',409);
   if(!provider||typeof provider.printPdf!=='function')
     fail('Emissor fiscal sem geração de PDF configurada',503);
   const content=await provider.printPdf({document:doc});
   if(!(Buffer.isBuffer(content)||content instanceof Uint8Array))
     fail('Emissor fiscal não retornou PDF válido',502);
   const pdf=Buffer.from(content);
   if(pdf.length<8||pdf.length>6*1024*1024||pdf.subarray(0,5).toString('ascii')!=='%PDF-')
     fail('Arquivo PDF fiscal inválido',502);
   return pdf;
 }
 async function finishFiscalCancellation(documentId,attemptId,result,providerName){
   const doc=await getFiscalDocument(documentId);
   if(doc.status!=='INDETERMINADO'||doc.attempt_id!==attemptId)
     fail('Tentativa de cancelamento fiscal conflitante',409);
   const marker=JSON.parse(doc.response_json||'{}');
   if(marker.operation!=='CANCEL')fail('Operação fiscal não é cancelamento',409);
   if(clean(result?.status).toUpperCase()!=='CANCELADA'){
     await uncertain(doc.id,'Cancelamento não confirmado pelo fisco; somente consulta é permitida');
     return getFiscalDocument(doc.id);
   }
   const environment=clean(result.environment),accessKey=clean(result.accessKey),
     protocol=clean(result.protocol),receiptXml=clean(result.xml);
   // ACBrLib NFE_Cancelar pode retornar XML vazio mesmo após cStat=101.
   // Aceitar nesse caso somente prova estruturada do retorno oficial, nunca
   // sucesso genérico de solicitação ou corpo arbitrário do navegador.
   const proof=result?.officialReceipt;
   const validProof=proof&&proof.cStat===101&&clean(proof.receivedAt).length>=10&&
     clean(proof.accessKey)===accessKey&&clean(proof.protocol)===protocol&&
     clean(proof.environment)===environment;
   if(environment!==doc.environment||accessKey!==doc.access_key||
       !protocol||receiptXml.length>4*1024*1024||
       (!receiptXml.startsWith('<')&&!validProof))
     fail('Comprovante de cancelamento divergente ou incompleto',409);
   const at=now();
   const receipt={operation:'CANCEL',status:'CANCELADA',provider:providerName,
     environment,accessKey,cancellationProtocol:protocol,
     cancellationXml:receiptXml||null,
     ...(validProof?{officialReceipt:proof}:{})};
   const update={sql:`UPDATE fiscal_documents
     SET status='CANCELADA',response_json=?,last_error='',updated_at=?
     WHERE id=? AND status='INDETERMINADO' AND attempt_id=?`,
     params:[JSON.stringify(receipt),at,doc.id,attemptId]};
   const event={sql:`INSERT INTO fiscal_events(id,document_id,event_type,details_json,created_at)
     VALUES(?,?,?,?,?)`,params:[nextId(),doc.id,'CANCELADA',
       JSON.stringify({protocol,accessKey,provider:providerName}),at]};
   if(port.engine==='d1'){
     const rows=await port.batch([update,{sql:event.sql.replace('VALUES(?,?,?,?,?)',
       'SELECT ?,?,?,?,? WHERE changes()=1'),params:event.params}]);
     if(changed(rows[0])!==1)fail('Cancelamento já conciliado',409);
   }else await port.transaction(async tx=>{
     if(changed(await tx.run(update.sql,update.params))!==1)fail('Cancelamento já conciliado',409);
     await tx.run(event.sql,event.params);
   });
   return getFiscalDocument(doc.id);
 }
 async function cancelFiscalDocument(documentId,{reason}={}){
   const doc=await getFiscalDocument(documentId);
   if(!['AUTORIZADA','AUTORIZADA_HOMOLOGACAO'].includes(doc.status))
     fail('Somente nota autorizada pode ser cancelada; operação indeterminada exige consulta',409);
   const justification=clean(reason);
   if(justification.length<15||justification.length>255||/[\r\n]/.test(justification))
     fail('Justificativa de cancelamento deve ter 15 a 255 caracteres, em uma linha');
   if(!provider||typeof provider.cancel!=='function'||typeof provider.consultCancellation!=='function')
     fail('Cancelamento fiscal indisponível no emissor configurado',503);
   const issuer=JSON.parse(doc.issuer_snapshot_json||'{}');
   if(!issuer?.cnpj||!doc.access_key||!doc.protocol||!doc.authorized_xml)
     fail('Documento sem identificação fiscal autorizada',409);
   if(typeof provider.prepareCancellation==='function')
     await provider.prepareCancellation({document:doc,issuer,reason:justification});
   const attemptId=randomUUID(),at=now(),providerName=clean(provider.name)||'local';
   const update={sql:`UPDATE fiscal_documents SET
     status='INDETERMINADO',attempt_id=?,response_json=?,last_error='',updated_at=?
     WHERE id=? AND status=?`,params:[attemptId,JSON.stringify({
       operation:'CANCEL',startedAt:at,reasonHash:sha(justification)
     }),at,doc.id,doc.status]};
   const event={sql:`INSERT INTO fiscal_events(id,document_id,event_type,details_json,created_at)
     VALUES(?,?,?,?,?)`,params:[nextId(),doc.id,'CANCELAMENTO_INICIADO',
       JSON.stringify({attemptId,reason:justification,provider:providerName}),at]};
   if(port.engine==='d1'){
     const rows=await port.batch([update,{sql:event.sql.replace('VALUES(?,?,?,?,?)',
       'SELECT ?,?,?,?,? WHERE changes()=1'),params:event.params}]);
     if(changed(rows[0])!==1)fail('Cancelamento já em processamento',409);
   }else await port.transaction(async tx=>{
     if(changed(await tx.run(update.sql,update.params))!==1)
       fail('Cancelamento já em processamento',409);
     await tx.run(event.sql,event.params);
   });
   try{
     const result=await provider.cancel({document:await getFiscalDocument(doc.id),
       attemptId,reason:justification});
     return await finishFiscalCancellation(doc.id,attemptId,result,providerName);
   }catch(error){await uncertain(doc.id,error?.message||error);throw error;}
 }
 async function reconcileFiscalDocument(documentId){
   const doc=await getFiscalDocument(documentId);
   if(doc.status!=='INDETERMINADO')fail('Somente documentos indeterminados podem ser consultados',409);
   const marker=JSON.parse(doc.response_json||'{}');
   const cancel=marker.operation==='CANCEL';
   const method=cancel?'consultCancellation':'consult';
   if(!provider||typeof provider[method]!=='function')
     fail('Consulta fiscal do emissor não configurada',503);
   let result;
   try{result=await provider[method]({document:doc,attemptId:doc.attempt_id});}
   catch(error){await uncertain(doc.id,error?.message||error);throw error;}
   return cancel
     ?finishFiscalCancellation(doc.id,doc.attempt_id,result,clean(provider.name)||'local')
     :applyResult(doc.id,doc.attempt_id,result,clean(provider.name)||'local');
 }
 return Object.freeze({getFiscalSettings,setFiscalSettings,getFiscalOnboardingStatus,
   installFiscalCertificate,installFiscalCsc,diagnoseFiscal,saveFiscalTaxReview,getFiscalDocument,
   getFiscalEvents,listFiscalDocuments,submitFiscalDocument,reconcileFiscalDocument,
   cancelFiscalDocument,getFiscalPdf});
}
