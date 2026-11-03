import { networkInterfaces } from 'node:os';

export function resolveServerConfig(env = process.env) {
  const host = typeof env.HOST === 'string' && env.HOST.trim() ? env.HOST.trim() : '127.0.0.1';
  const secure=Boolean(env.TLS_CERT_PATH&&env.TLS_KEY_PATH);
  const local=['127.0.0.1','localhost','::1','[::1]'].includes(host);
  if(!local&&!secure)throw new Error('Acesso LAN exige HTTPS com TLS_CERT_PATH e TLS_KEY_PATH');
  if(Boolean(env.TLS_CERT_PATH)!==Boolean(env.TLS_KEY_PATH))throw new Error('HTTPS exige certificado e chave TLS');
  const rawPort = env.PORT == null || env.PORT === '' ? 3344 : Number(env.PORT);
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) throw new Error('PORT inválida');
  return { host, port: rawPort };
}

export function listLanUrls({ port = 3344, interfaces = networkInterfaces(), secure = false } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
  const addresses = new Set();
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;
      if (isIpv4 && !entry.internal && entry.address) addresses.add(entry.address);
    }
  }
  return [...addresses].sort().map(address => `${secure?'https':'http'}://${address}:${port}`);
}
