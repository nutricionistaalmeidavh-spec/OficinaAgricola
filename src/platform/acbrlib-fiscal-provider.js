// ACBrLib REAL, self-hosted e opt-in, sem dependências do núcleo comercial.
// A aplicação nunca gera imposto por inferência: exige INI fiscal revisado,
// manifesto vinculado ao snapshot canônico e ACBrLib compilada/instalada pelo operador.
// Segredos do certificado permanecem na configuração externa da própria ACBrLib.
import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomInt} from 'node:crypto';
import {readFileSync,realpathSync,statSync,writeFileSync,existsSync,renameSync,rmSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareReviewedFiscalIni,compileReviewedFiscalIni} from './fiscal-ini-preparer.js';

function localFile(path,label){
  if(typeof path!=='string'||!isAbsolute(path))
    throw new Error('Caminho absoluto obrigatório para '+label);
  const actual=realpathSync(path),stat=statSync(actual);
  if(!stat.isFile())throw new Error(label+' não é arquivo');
  return actual;
}
function localDirectory(path,label){
  if(typeof path!=='string'||!isAbsolute(path))
    throw new Error('Caminho absoluto obrigatório para '+label);
  const actual=realpathSync(path);
  if(!statSync(actual).isDirectory())throw new Error(label+' não é diretório');
  return actual;
}
function loadManifest(file,expected){
  const raw=readFileSync(file,'utf8');
  if(raw.length>16*1024)throw new Error('Manifesto fiscal excede limite');
  let metadata;
  try{metadata=JSON.parse(raw)}catch{throw new Error('Manifesto fiscal inválido')}
  if(Object.entries(expected).some(([key,value])=>metadata?.[key]!==value))
    throw new Error('Manifesto fiscal não corresponde ao snapshot, valor ou emitente');
}
function resolveInputs(inputDir,document,issuer){
  const hash=document?.snapshot_hash;
  if(!/^[0-9a-f]{64}$/.test(hash||'')||!Number.isSafeInteger(Number(document?.id))||
      !['NFE','NFCE','NFSE'].includes(document?.kind))
    throw new Error('Documento fiscal canônico inválido');
  const stem=document.kind+'-'+document.id+'-'+hash;
  const base=resolve(inputDir,stem);
  if(!base.startsWith(inputDir+(/[/\\]$/.test(inputDir)?'':'/'))&&
      !base.startsWith(inputDir+'\\'))
    throw new Error('Caminho fiscal inválido');
  let iniPath,manifestPath;
  try{
    iniPath=localFile(base+'.ini','INI tributário ACBr');
    manifestPath=localFile(base+'.json','Manifesto fiscal ACBr');
  }catch{
    throw new Error('INI tributário ou manifesto fiscal ACBr não preparado para este documento');
  }
  if(!iniPath.startsWith(inputDir+'/')&&!iniPath.startsWith(inputDir+'\\')||
     !manifestPath.startsWith(inputDir+'/')&&!manifestPath.startsWith(inputDir+'\\'))
    throw new Error('Arquivo fiscal deve permanecer no diretório configurado');
  if(statSync(iniPath).size>1024*1024||statSync(iniPath).size<12)
    throw new Error('INI fiscal vazio ou maior que o limite');
  loadManifest(manifestPath,{
    kind:document.kind,documentId:Number(document.id),snapshotHash:hash,
    amountCents:Number(document.amount_cents),
    issuerCnpj:String(issuer?.cnpj||''),environment:issuer?.environment
  });
  return iniPath;
}
function workerFile(){
  const file=fileURLToPath(new URL('./acbrlib-worker.py',import.meta.url));
  // electron-builder guarda scripts executáveis fora do ASAR.
  return file.includes('app.asar')?file.replace('app.asar','app.asar.unpacked'):file;
}
function executeWorker(data,{python,workerExe,timeoutMs=90000}){
  return new Promise((resolveResult,reject)=>{
    // Em instalações Windows, o executor PyInstaller é autônomo: não depende de Python no PATH.
    const proc=spawn(workerExe||python,workerExe?[]:[workerFile()],{
      windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
    });
    let out='',err='',settled=false;
    const stopError=msg=>{
      if(settled)return;settled=true;
      proc.kill();
      reject(new Error(msg));
    };
    const timer=setTimeout(()=>stopError('ACBrLib excedeu o tempo seguro; consultar autorização antes de reenviar'),timeoutMs);
    proc.on('error',()=>stopError('Python 3 não instalado ou executor ACBrLib indisponível'));
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data',chunk=>{out+=chunk;if(out.length>9*1024*1024)stopError('Resposta ACBrLib excede limite')});
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data',chunk=>{err+=chunk.slice(0,2000);if(err.length>8000)err=err.slice(0,8000)});
    proc.on('close',code=>{
      clearTimeout(timer);
      if(settled)return;settled=true;
      if(code!==0)return reject(new Error('ACBrLib terminou sem confirmação oficial; consulte a situação fiscal'));
      try{
        const result=JSON.parse(out);
        if(!result||typeof result!=='object'||Array.isArray(result))
          throw new Error('Resposta não é objeto');
        resolveResult(result);
      }catch{return reject(new Error('Resposta inválida do executor ACBrLib; consultar situação fiscal'))}
    });
    proc.stdin.on('error',()=>{});
    proc.stdin.end(JSON.stringify(data));
  });
}
export function createAcbrLibFiscalProvider(opts={}){
  const nfeLib=opts.nfeLib??process.env.FISCAL_ACBR_NFE_LIB;
  const nfseLib=opts.nfseLib??process.env.FISCAL_ACBR_NFSE_LIB;
  if(!nfeLib&&!nfseLib)return null;
  const inputDir=localDirectory(opts.inputDir??process.env.FISCAL_ACBR_INPUT_DIR,'diretório INI fiscal');
  const libraries={};
  if(nfeLib)libraries.NFE={
    libraryPath:localFile(nfeLib,'ACBrLibNFe'),
    configPath:localFile(opts.nfeConfig??process.env.FISCAL_ACBR_NFE_CONFIG,'configuração ACBrLibNFe')
  };
  if(nfseLib)libraries.NFSE={
    libraryPath:localFile(nfseLib,'ACBrLibNFSe'),
    configPath:localFile(opts.nfseConfig??process.env.FISCAL_ACBR_NFSE_CONFIG,'configuração ACBrLibNFSe')
  };
  const python=opts.python??process.env.FISCAL_ACBR_PYTHON??(process.platform==='win32'?'python':'python3');
  const workerExe=opts.workerExe??process.env.FISCAL_ACBR_WORKER_EXE;
  const validatedWorker=workerExe?localFile(workerExe,'executor ACBrLib integrado'):null;
  const runner=opts.runner??(args=>executeWorker(args,{python,workerExe:validatedWorker}));
  const certificateStore=opts.certificateStore||null;
  const invoke=async args=>certificateStore
    ?certificateStore.withConfig({
       kind:args.kind,environment:args.environment,uf:args.issuerUf
     },configPath=>runner({...args,configPath}))
    :runner(args);
  const preflight=({document,issuer})=>{
    const kind=document?.kind;
    const libraryKind=kind==='NFCE'?'NFE':kind;
    if(!libraries[libraryKind])throw new Error('Biblioteca ACBrLib para '+kind+' não configurada');
    const safeIssuer=issuer||(document.issuer_snapshot_json?JSON.parse(document.issuer_snapshot_json):null);
    if(!safeIssuer?.cnpj||!safeIssuer?.environment)
      throw new Error('Emitente fiscal ausente; configure antes do envio ACBr');
    // Se houver revisão tributária do documento, gerar INI e manifesto vinculados
    // ao snapshot. Nunca inferir impostos, NCM, CFOP ou condições de produção.
    if(certificateStore&&!certificateStore.status().configured)
      throw new Error('Cadastre o certificado A1 desta unidade antes da emissão');
    prepareReviewedFiscalIni({inputDir,document,issuer:safeIssuer});
    const iniPath=resolveInputs(inputDir,document,safeIssuer);
    return {kind,documentId:Number(document.id),iniPath,
      snapshotHash:document.snapshot_hash,amountCents:Number(document.amount_cents),environment:safeIssuer.environment,
      issuerCnpj:safeIssuer.cnpj,issuerUf:safeIssuer.uf,
      ...libraries[libraryKind],issuerUf:safeIssuer.uf};
  };
  return {
    name:'acbrlib-local',
    saveTaxReview:({document,issuer,sections}={})=>{
      if(!document||document.kind!=='NFE'||document.status!=='RASCUNHO')
        throw new Error('Revisão tributária permitida apenas para rascunho NF-e');
      if(!sections||typeof sections!=='object'||Array.isArray(sections)||
         !sections.Identificacao||typeof sections.Identificacao!=='object')
        throw new Error('Identificação tributária NF-e inválida');
      const scopedSections=structuredClone(sections);
      if(!scopedSections.Identificacao.cNF)
        scopedSections.Identificacao.cNF=String(randomInt(0,100000000)).padStart(8,'0');
      const review={kind:'NFE',documentId:Number(document.id),
        snapshotHash:document.snapshot_hash,amountCents:Number(document.amount_cents),
        issuerCnpj:issuer?.cnpj,environment:issuer?.environment,sections:scopedSections};
      // Validação detalhada antes de persistir. Nenhum XML é assinado ou enviado aqui.
      compileReviewedFiscalIni({document,issuer,review});
      const filename='NFE-'+document.id+'-'+document.snapshot_hash;
      const target=join(inputDir,filename+'.review.json');
      if(existsSync(join(inputDir,filename+'.ini'))||
         existsSync(join(inputDir,filename+'.json')))
        throw new Error('Documento fiscal já preparado; não alterar tributação após preparo');
      const tmp=target+'.new-'+randomBytes(8).toString('hex');
      const raw=JSON.stringify(review);
      try{
        writeFileSync(tmp,raw,{flag:'wx',mode:0o600});
        renameSync(tmp,target);
      }finally{if(existsSync(tmp))rmSync(tmp,{force:true});}
      return {reviewed:true,reviewHash:createHash('sha256').update(raw).digest('hex')};
    },
    certificateStatus:()=>certificateStore?certificateStore.status():{configured:false},
    installCertificate:input=>{
      if(!certificateStore)throw new Error('Instalação de certificado disponível apenas no Oficina local');
      return certificateStore.install(input);
    },
    diagnose:async({settings}={})=>{
      if(!settings||!settings.enabled||!settings.issuer_cnpj||!settings.issuer_uf)
        throw new Error('Complete o cadastro fiscal desta empresa antes do diagnóstico');
      if(!certificateStore?.status().configured)
        throw new Error('Cadastre o certificado A1 da empresa antes do diagnóstico');
      if(!libraries.NFE)return {ready:false,nfe:{status:'BIBLIOTECA_AUSENTE'},
        nfse:{status:'VERIFICACAO_MUNICIPAL_NECESSARIA'}};
      const basis={...libraries.NFE,kind:'NFE',environment:settings.environment,
        issuerCnpj:settings.issuer_cnpj,issuerUf:settings.issuer_uf};
      const certificate=await invoke({...basis,operation:'certificate'});
      if(certificate?.status!=='CERTIFICATE_MATCH')
        return {ready:false,environment:settings.environment,
          certificate:{status:'CNPJ_NAO_CONFIRMADO'},
          nfe:{status:'NAO_TESTADO'},nfse:{status:'VERIFICACAO_MUNICIPAL_NECESSARIA'}};
      const response=await invoke({...basis,operation:'status'});
      return {ready:response?.status==='ONLINE',environment:settings.environment,
        certificate:{status:'CNPJ_CONFIRMADO'},
        nfe:{status:response?.status||'INDETERMINADO',
          code:response?.code||null,uf:settings.issuer_uf},
        nfse:{status:'VERIFICACAO_MUNICIPAL_NECESSARIA'}};
    },
    prepare:preflight,
    transmit:({document,attemptId})=>invoke({...preflight({document}),operation:'transmit',
      attemptId,lot:Number(document.id)}),
    consult:({document,attemptId})=>invoke({...preflight({document}),operation:'consult',
      attemptId,lot:Number(document.id),accessKey:document.access_key||null}),
    prepareCancellation:({document,issuer})=>{
      if(!document?.access_key||!document?.protocol||!document?.authorized_xml)
        throw new Error('Cancelamento exige documento autorizado e XML original');
      return preflight({document,issuer});
    },
    cancel:({document,attemptId,reason})=>invoke({...preflight({document}),operation:'cancel',
      attemptId,lot:Number(document.id),accessKey:document.access_key||null,
      authorizedXml:document.authorized_xml,originalProtocol:document.protocol,reason}),
    consultCancellation:({document,attemptId})=>invoke({
      ...preflight({document}),operation:'consultCancellation',
      attemptId,lot:Number(document.id),accessKey:document.access_key||null
    }),
    printPdf:async({document})=>{
      const result=await invoke({...preflight({document}),operation:'pdf',
        accessKey:document.access_key||null,authorizedXml:document.authorized_xml,
        originalProtocol:document.protocol});
      if(result?.status!=='PDF'||typeof result.pdfBase64!=='string'||
          result.pdfBase64.length>8*1024*1024||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(result.pdfBase64))
        throw new Error('ACBrLib não retornou um PDF válido');
      return Buffer.from(result.pdfBase64,'base64');
    }
  };
}
