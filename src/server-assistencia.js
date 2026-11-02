import { createServer } from 'node:http';
import { openDatabase, migrate, transaction } from './db.js';
import { validateSession } from './auth.js';
import { createAppServer } from './server.js';
import { migrateAssistencia } from './assistencia-schema.js';
import {enqueueHttpEvent,dispatchOutbox} from './platform/outbox.js';
import {runIdempotent} from './platform/idempotency.js';
import {
  addCashMovement,
  cancelSale,
  cashSummary,
  closeCashSession,
  createSale,
  createService,
  getOpenCashSession,
  getSale,
  listCashSessions,
  listSales,
  listServices,
  openCashSession,
  updateService,
} from './services/sales.js';

const SALES_ROLES = new Set(['ADMIN', 'ATENDIMENTO', 'FINANCEIRO']);
const CASH_ROLES = new Set(['ADMIN', 'ATENDIMENTO', 'FINANCEIRO']);
const SALE_CANCEL_ROLES = new Set(['ADMIN', 'FINANCEIRO']);
const SERVICE_WRITE_ROLES = new Set(['ADMIN', 'ATENDIMENTO']);

function json(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req, max = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('Corpo da requisição excede o limite');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSON inválido'); }
}

function tokenFrom(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

function requireUser(db, req, allowed) {
  const user = validateSession(db, tokenFrom(req));
  if (allowed && !allowed.has(user.role)) throw new Error('Permissão insuficiente');
  return user;
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Identificador inválido');
  return id;
}

function errorStatus(error) {
  const message = String(error?.message || '');
  if (/Credenciais|Sessão/.test(message)) return 401;
  if (/Permissão/.test(message)) return 403;
  if (/não encontrad/i.test(message)) return 404;
  if (/já |insuficiente|caixa aberto|Abra o caixa|UNIQUE constraint/i.test(message)) return 409;
  return 400;
}

function respond(status,data){return {status,data};}

function isAssistenciaApi(pathname) {
  return pathname === '/api/services' || pathname.startsWith('/api/services/') ||
    pathname === '/api/sales' || pathname.startsWith('/api/sales/') ||
    pathname === '/api/cash/current' || pathname.startsWith('/api/cash/current/') ||
    pathname === '/api/cash/open' || pathname === '/api/cash/sessions';
}

function handleAssistenciaApi({ req, res, url, db, body }) {
  const method = req.method || 'GET';
  const path = url.pathname;
  let match;

  if (path === '/api/services' && method === 'GET') {
    requireUser(db, req);
    return respond(200, listServices(db, {
      includeInactive: url.searchParams.get('includeInactive') === '1',
      search: url.searchParams.get('search') || '',
    }));
  }
  if (path === '/api/services' && method === 'POST') {
    requireUser(db, req, SERVICE_WRITE_ROLES);
    return respond(200, createService(db, body));
  }
  if ((match = path.match(/^\/api\/services\/(\d+)$/)) && method === 'PATCH') {
    requireUser(db, req, SERVICE_WRITE_ROLES);
    return respond(200, updateService(db, positiveId(match[1]), body));
  }

  if (path === '/api/sales' && method === 'GET') {
    requireUser(db, req, SALES_ROLES);
    return respond(200, listSales(db, { limit: url.searchParams.get('limit') || 100 }));
  }
  if (path === '/api/sales' && method === 'POST') {
    const user = requireUser(db, req, SALES_ROLES);
    return respond(200, createSale(db, body, { userId: user.id }));
  }
  if ((match = path.match(/^\/api\/sales\/(\d+)$/)) && method === 'GET') {
    requireUser(db, req, SALES_ROLES);
    return respond(200, getSale(db, positiveId(match[1])));
  }
  if ((match = path.match(/^\/api\/sales\/(\d+)\/cancel$/)) && method === 'POST') {
    const user = requireUser(db, req, SALE_CANCEL_ROLES);
    return respond(200, cancelSale(db, positiveId(match[1]), { ...(body), userId: user.id }));
  }

  if (path === '/api/cash/current' && method === 'GET') {
    requireUser(db, req, SALES_ROLES);
    return respond(200, getOpenCashSession(db));
  }
  if (path === '/api/cash/current/summary' && method === 'GET') {
    requireUser(db, req, SALES_ROLES);
    return respond(200, cashSummary(db));
  }
  if (path === '/api/cash/sessions' && method === 'GET') {
    requireUser(db, req, CASH_ROLES);
    return respond(200, listCashSessions(db, { limit: url.searchParams.get('limit') || 30 }));
  }
  if (path === '/api/cash/open' && method === 'POST') {
    const user = requireUser(db, req, CASH_ROLES);
    return respond(200, openCashSession(db, { ...(body), userId: user.id }));
  }
  if (path === '/api/cash/current/movements' && method === 'POST') {
    const user = requireUser(db, req, CASH_ROLES);
    return respond(200, addCashMovement(db, { ...(body), userId: user.id }));
  }
  if (path === '/api/cash/current/close' && method === 'POST') {
    requireUser(db, req, CASH_ROLES);
    return respond(200, closeCashSession(db, body));
  }

  return respond(404, { error: 'Rota não encontrada' });
}

export function createAssistenciaServer({
  db = openDatabase(process.env.DATABASE_PATH || './data/artisys-oficina.sqlite'),
  storageDir = process.env.STORAGE_DIR || './storage/assistencia-tecnica/uploads',
  eventRuntime = null,
} = {}) {
  migrate(db);
  migrateAssistencia(db);
  const baseServer = createAppServer({ db, storageDir, eventRuntime });

  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!isAssistenciaApi(url.pathname)) {
      baseServer.emit('request', req, res);
      return;
    }
    try {
      const mutation=['POST','PUT','PATCH','DELETE'].includes(req.method||'');
      const body=mutation?await readJson(req):{};
      const actor=mutation?validateSession(db,tokenFrom(req)):null;
      const invoke=()=>handleAssistenciaApi({req,res,url,db,body});
      const answer=mutation?transaction(db,()=>{
        const output=runIdempotent(db,`http:${req.method}:${url.pathname}:user:${actor.id}`,
          body.requestId??req.headers['idempotency-key'],{body},invoke);
        if(output.status>=200&&output.status<300)enqueueHttpEvent(db,req.method,url.pathname,output.data);
        return output;
      }):invoke();
      json(res,answer.status,answer.data);
      if(mutation&&answer.status>=200&&answer.status<300&&eventRuntime)
        void dispatchOutbox(db,eventRuntime).catch(e=>console.error('[outbox]',e.message));
    } catch (error) {
      console.error('[assistencia]', req.method, url.pathname, error.message);
      json(res, errorStatus(error), { error: error.message || 'Erro interno' });
    }
  });
}
