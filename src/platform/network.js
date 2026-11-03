import { networkInterfaces } from 'node:os';

export function resolveServerConfig(env = process.env) {
  const host = typeof env.HOST === 'string' && env.HOST.trim() ? env.HOST.trim() : '127.0.0.1';
  if(!['127.0.0.1','::1','localhost'].includes(host)&&(!env.HTTPS_CERT_FILE||!env.HTTPS_KEY_FILE))
    throw new Error('HTTPS é obrigatório para acesso LAN: configure HTTPS_CERT_FILE e HTTPS_KEY_FILE');
  const rawPort = env.PORT == null || env.PORT === '' ? 3344 : Number(env.PORT);
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) throw new Error('PORT inválida');
  return { host, port: rawPort };
}

const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
export function assertSecureNetwork(req){
  if(!loopback.has(String(req.socket?.remoteAddress||''))&&!req.socket?.encrypted)
    throw new Error('HTTPS obrigatório para conexões de rede local');
}

export function listLanUrls({ port = 3344, interfaces = networkInterfaces(),protocol='https' } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
  const addresses = new Set();
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;
      if (isIpv4 && !entry.internal && entry.address) addresses.add(entry.address);
    }
  }
  return [...addresses].sort().map(address => `${protocol}://${address}:${port}`);
}
