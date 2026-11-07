// Contrato único do produto: integração fiscal totalmente desativada.
// Preserva os dados históricos no banco, sem habilitar emissões ou configurações.
export const FISCAL_DISABLED_MESSAGE='Integração fiscal desativada nesta versão do Oficina.';
export function isFiscalApiPath(path){
 return /^\/api\/fiscal(?:\/|$)/.test(String(path||''))||
  /^\/api\/tenancy\/os-transfer\/[1-9][0-9]*\/fiscal\/[1-9][0-9]*\/xml$/.test(String(path||''));
}
export function isNativeFiscalPath(path){
 return /^\/v1\/fiscal(?:\/|$)/.test(String(path||''));
}
