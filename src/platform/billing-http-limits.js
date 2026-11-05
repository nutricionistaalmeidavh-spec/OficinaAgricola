// HTTP body bounds shared by local, multiempresa and PostgreSQL gateways.
// 1 MiB of bank-file text plus JSON and UTF-8 overhead; max 1000 rows at parser.
export const MAX_BANK_IMPORT_REQUEST_BYTES=1150000;
export function requestPayloadLimit(method,path,defaultBytes=1048576){
 if(method==='POST'&&path==='/api/fiscal/certificate')
  return 5*1024*1024;
 if(method==='POST'&&path==='/api/billing/statements/import')
  return MAX_BANK_IMPORT_REQUEST_BYTES;
 if(method==='POST'&&/^\/api\/work-orders\/[1-9][0-9]*\/attachments$/.test(path))
  return 7*1024*1024;
 return defaultBytes;
}
