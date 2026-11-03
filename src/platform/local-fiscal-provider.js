// Adapter opt-in para emissor SELF-HOSTED local. Nenhum provedor remoto ou mensalidade.
// O sidecar é responsável por certificado, XML assinado, schemas e respostas oficiais.
// Esta ponte NÃO afirma que ACBr ou qualquer outro emissor já está instalado.
export function createLocalFiscalProvider({url=process.env.FISCAL_LOCAL_PROVIDER_URL}={}){
  if(!url||!String(url).trim())return null;
  let endpoint;
  try{endpoint=new URL(String(url))}catch{throw new Error('URL do emissor fiscal local inválida')}
  if(endpoint.protocol!=='http:'||
      !['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||
      endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
    throw new Error('Emissor fiscal deve usar somente HTTP loopback sem credenciais na URL');
  const call=async(path,payload)=>{
    const target=new URL(path,endpoint);
    // Nunca seguir redirecionamentos que possam enviar documentos fiscais para fora do computador.
    const response=await fetch(target,{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(payload),
      redirect:'error',
      signal:AbortSignal.timeout(20000)
    });
    if(!response.ok)throw new Error('Emissor fiscal local respondeu HTTP '+response.status);
    const raw=await response.text();
    if(raw.length>4*1024*1024)throw new Error('Resposta fiscal excede limite');
    let result;
    try{result=JSON.parse(raw)}catch{throw new Error('Resposta fiscal local não é JSON válido')}
    if(!result||typeof result!=='object'||Array.isArray(result))
      throw new Error('Resposta fiscal local inválida');
    return result;
  };
  return {
    name:'sidecar-local',
    transmit:({document,attemptId})=>call('/v1/fiscal/transmit',{
      documentId:document.id,kind:document.kind,requestId:document.request_id,
      attemptId,snapshot:JSON.parse(document.snapshot_json),
      snapshotHash:document.snapshot_hash
    }),
    consult:({document,attemptId})=>call('/v1/fiscal/consult',{
      documentId:document.id,kind:document.kind,requestId:document.request_id,
      attemptId,accessKey:document.access_key||null
    })
  };
}
