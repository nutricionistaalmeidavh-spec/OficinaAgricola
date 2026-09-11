import { networkInterfaces } from 'node:os';

export function resolveServerConfig(env = process.env) {
  const host = typeof env.HOST === 'string' && env.HOST.trim() ? env.HOST.trim() : '0.0.0.0';
  const rawPort = env.PORT == null || env.PORT === '' ? 3333 : Number(env.PORT);
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) throw new Error('PORT inválida');
  return { host, port: rawPort };
}

export function listLanUrls({ port = 3333, interfaces = networkInterfaces() } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
  const addresses = new Set();
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;
      if (isIpv4 && !entry.internal && entry.address) addresses.add(entry.address);
    }
  }
  return [...addresses].sort().map(address => `http://${address}:${port}`);
}
