// FacturaSimple — servidor sin dependencias (solo Node.js >= 18)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Base de datos en archivo JSON ----------
const EMPTY_DB = {
  settings: {
    businessName: 'Mi Negocio',
    taxId: '',
    address: '',
    phone: '',
    email: '',
    logoUrl: '',
    currency: 'COP',
    locale: 'es-CO',
    defaultTax: 19,
    invoicePrefix: 'FAC-',
    quotePrefix: 'COT-',
    nextInvoice: 1,
    nextQuote: 1,
    footer: 'Gracias por su confianza.',
    paymentInfo: '',
    invoiceLabel: 'Cuenta de cobro',
    timezone: 'America/Bogota'
  },
  auth: null, // { salt, hash, secret }
  clients: [],
  documents: []
};

let db;
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.settings = { ...EMPTY_DB.settings, ...db.settings };
    db.clients ||= [];
    db.documents ||= [];
  } catch {
    db = structuredClone(EMPTY_DB);
    saveDb();
  }
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
loadDb();

// ---------- Autenticación ----------
function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.auth = { salt, hash: hashPassword(pw, salt), secret: crypto.randomBytes(32).toString('hex') };
  saveDb();
}
// Contraseña inicial desde variable de entorno (recomendado).
// Si no existe, la configuración inicial exige un código que solo aparece en los registros del servidor,
// para que un desconocido no pueda adueñarse de una instalación recién creada.
if (!db.auth && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 8) console.warn('ADMIN_PASSWORD debe tener al menos 8 caracteres; se ignora.');
  else setPassword(process.env.ADMIN_PASSWORD);
}
const SETUP_CODE = db.auth ? null : (process.env.SETUP_CODE || crypto.randomBytes(4).toString('hex'));
if (SETUP_CODE) {
  console.log('==============================================');
  console.log(' Código de configuración inicial: ' + SETUP_CODE);
  console.log(' (o define la variable ADMIN_PASSWORD)');
  console.log('==============================================');
}

function sign(value) {
  return crypto.createHmac('sha256', db.auth.secret).update(value).digest('hex');
}
function makeSession() {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const payload = String(exp);
  return payload + '.' + sign(payload);
}
function isAuthed(req) {
  if (!db.auth) return false;
  const cookie = parseCookies(req).fs_session;
  if (!cookie) return false;
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const loginAttempts = new Map();
// IP real del visitante. Detrás de un proxy (Hostinger, Nginx, Traefik) se usa la última IP de
// X-Forwarded-For, que la añade el propio proxy y el visitante no puede falsificar.
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress;
}
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  loginAttempts.set(ip, list);
  return list.length >= 10;
}

// ---------- Utilidades ----------
const id = () => crypto.randomBytes(8).toString('hex');
// Fecha de hoy (AAAA-MM-DD) en la zona horaria del negocio, no en UTC
function today() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: db.settings.timezone || 'America/Bogota' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v, fallback = '') => DATE_RE.test(String(v ?? '')) ? String(v) : fallback;

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
  });
}
const str = (v, max = 500) => String(v ?? '').slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function computeTotals(doc) {
  let subtotal = 0, tax = 0;
  for (const it of doc.items) {
    const line = num(it.qty) * num(it.price);
    subtotal += line;
    tax += line * num(it.tax) / 100;
  }
  const discount = num(doc.discount);
  const total = subtotal - discount + tax;
  const paid = (doc.payments || []).reduce((s, p) => s + num(p.amount), 0);
  return { subtotal, tax, discount, total, paid, balance: total - paid };
}
function docStatus(doc) {
  if (doc.status === 'anulada') return 'anulada';
  const t = computeTotals(doc);
  if (doc.type === 'factura') {
    if (t.total > 0 && t.balance <= 0.005) return 'pagada';
    if (doc.dueDate && doc.dueDate < today()) return 'vencida';
    if (t.paid > 0) return 'abonada';
  }
  return doc.status || 'borrador';
}
function enrich(doc) {
  const client = db.clients.find(c => c.id === doc.clientId) || null;
  return { ...doc, client, totals: computeTotals(doc), computedStatus: docStatus(doc) };
}
function sanitizeDoc(input, existing = {}) {
  const items = Array.isArray(input.items) ? input.items.slice(0, 200).map(it => ({
    description: str(it.description, 1000),
    qty: num(it.qty),
    price: num(it.price),
    tax: num(it.tax)
  })) : (existing.items || []);
  return {
    clientId: str(input.clientId ?? existing.clientId, 40),
    date: date(input.date, existing.date || today()),
    dueDate: 'dueDate' in input ? date(input.dueDate, '') : (existing.dueDate || ''),
    items,
    discount: num(input.discount ?? existing.discount),
    notes: str(input.notes ?? existing.notes, 3000),
    status: ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada'].includes(input.status) ? input.status : (existing.status || 'borrador')
  };
}
function nextNumber(type) {
  const s = db.settings;
  if (type === 'factura') return s.invoicePrefix + String(s.nextInvoice++).padStart(4, '0');
  return s.quotePrefix + String(s.nextQuote++).padStart(4, '0');
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // Toda escritura debe ser JSON: bloquea formularios de otros sitios (CSRF)
  if (m !== 'GET' && m !== 'HEAD' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'Se esperaba JSON' });
  }

  // Estado inicial / login
  if (p === '/api/status' && m === 'GET') {
    return send(res, 200, { setup: !db.auth, authed: isAuthed(req) });
  }
  if (p === '/api/setup' && m === 'POST') {
    if (db.auth) return send(res, 400, { error: 'Ya está configurado' });
    const ip = clientIp(req);
    if (tooManyAttempts(ip)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    const b = await readBody(req);
    const code = String(b.setupCode || '').trim();
    if (code.length !== SETUP_CODE.length || !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(SETUP_CODE))) {
      loginAttempts.get(ip).push(Date.now());
      return send(res, 401, { error: 'Código de configuración incorrecto. Búscalo en los registros (logs) del servidor.' });
    }
    if (!b.password || String(b.password).length < 8) return send(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres' });
    setPassword(String(b.password));
    if (b.businessName) { db.settings.businessName = str(b.businessName, 200); saveDb(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (tooManyAttempts(ip)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    const b = await readBody(req);
    if (!db.auth) return send(res, 400, { error: 'Primero configura la app' });
    const h = hashPassword(String(b.password || ''), db.auth.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(db.auth.hash))) {
      loginAttempts.get(ip).push(Date.now());
      return send(res, 401, { error: 'Contraseña incorrecta' });
    }
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }
  if (p === '/api/logout' && m === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'fs_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
  }

  if (!isAuthed(req)) return send(res, 401, { error: 'No autorizado' });

  // Ajustes
  if (p === '/api/settings' && m === 'GET') return send(res, 200, db.settings);
  if (p === '/api/settings' && m === 'PUT') {
    const b = await readBody(req);
    const s = db.settings;
    for (const k of ['businessName', 'taxId', 'address', 'phone', 'email', 'currency', 'locale', 'invoicePrefix', 'quotePrefix', 'footer', 'paymentInfo', 'invoiceLabel']) {
      if (k in b) s[k] = str(b[k], 2000);
    }
    if ('logoUrl' in b) {
      const u = str(b.logoUrl, 2000).trim();
      if (u && !/^https?:\/\//i.test(u)) return send(res, 400, { error: 'La URL del logo debe empezar por https://' });
      s.logoUrl = u;
    }
    if ('timezone' in b) {
      try { new Intl.DateTimeFormat('en', { timeZone: String(b.timezone) }); s.timezone = String(b.timezone); }
      catch { return send(res, 400, { error: 'Zona horaria no válida' }); }
    }
    if (!s.invoiceLabel) s.invoiceLabel = 'Cuenta de cobro';
    if ('defaultTax' in b) s.defaultTax = Math.max(0, num(b.defaultTax));
    for (const k of ['nextInvoice', 'nextQuote']) if (k in b) s[k] = Math.max(1, Math.floor(num(b[k])));
    saveDb();
    return send(res, 200, s);
  }
  if (p === '/api/password' && m === 'PUT') {
    const b = await readBody(req);
    const h = hashPassword(String(b.current || ''), db.auth.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(db.auth.hash))) return send(res, 400, { error: 'La contraseña actual no es correcta' });
    if (!b.password || String(b.password).length < 8) return send(res, 400, { error: 'Mínimo 8 caracteres' });
    setPassword(String(b.password));
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession()) });
  }

  // Clientes
  if (p === '/api/clients' && m === 'GET') return send(res, 200, db.clients);
  if (p === '/api/clients' && m === 'POST') {
    const b = await readBody(req);
    if (!b.name) return send(res, 400, { error: 'El nombre es obligatorio' });
    const c = { id: id(), name: str(b.name, 200), taxId: str(b.taxId, 50), email: str(b.email, 200), phone: str(b.phone, 50), address: str(b.address, 500), createdAt: new Date().toISOString() };
    db.clients.push(c); saveDb();
    return send(res, 201, c);
  }
  let mt = p.match(/^\/api\/clients\/([a-f0-9]+)$/);
  if (mt) {
    const c = db.clients.find(x => x.id === mt[1]);
    if (!c) return send(res, 404, { error: 'Cliente no encontrado' });
    if (m === 'PUT') {
      const b = await readBody(req);
      for (const k of ['name', 'taxId', 'email', 'phone', 'address']) if (k in b) c[k] = str(b[k], 500);
      saveDb(); return send(res, 200, c);
    }
    if (m === 'DELETE') {
      if (db.documents.some(d => d.clientId === c.id)) return send(res, 400, { error: 'Este cliente tiene documentos; no se puede eliminar' });
      db.clients = db.clients.filter(x => x.id !== c.id); saveDb();
      return send(res, 200, { ok: true });
    }
  }

  // Documentos (facturas y cotizaciones)
  if (p === '/api/documents' && m === 'GET') {
    const type = url.searchParams.get('type');
    const list = db.documents.filter(d => !type || d.type === type).map(enrich).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
    return send(res, 200, list);
  }
  if (p === '/api/documents' && m === 'POST') {
    const b = await readBody(req);
    const type = b.type === 'factura' ? 'factura' : 'cotizacion';
    const fields = sanitizeDoc(b);
    if (!db.clients.some(c => c.id === fields.clientId)) return send(res, 400, { error: 'Selecciona un cliente' });
    if (!fields.items.length) return send(res, 400, { error: 'Agrega al menos una línea' });
    const d = { id: id(), type, number: nextNumber(type), token: crypto.randomBytes(16).toString('hex'), payments: [], createdAt: new Date().toISOString(), ...fields };
    db.documents.push(d); saveDb();
    return send(res, 201, enrich(d));
  }
  mt = p.match(/^\/api\/documents\/([a-f0-9]+)(\/(convert|payments|duplicate))?$/);
  if (mt) {
    const d = db.documents.find(x => x.id === mt[1]);
    if (!d) return send(res, 404, { error: 'Documento no encontrado' });
    const action = mt[3];
    if (!action && m === 'GET') return send(res, 200, enrich(d));
    if (!action && m === 'PUT') {
      const fields = sanitizeDoc(await readBody(req), d);
      if (!db.clients.some(c => c.id === fields.clientId)) return send(res, 400, { error: 'Selecciona un cliente' });
      if (!fields.items.length) return send(res, 400, { error: 'Agrega al menos una línea' });
      Object.assign(d, fields); saveDb();
      return send(res, 200, enrich(d));
    }
    if (!action && m === 'DELETE') {
      db.documents = db.documents.filter(x => x.id !== d.id); saveDb();
      return send(res, 200, { ok: true });
    }
    if (action === 'convert' && m === 'POST') {
      if (d.type !== 'cotizacion') return send(res, 400, { error: 'Solo las cotizaciones se pueden convertir' });
      const inv = { ...structuredClone(d), id: id(), type: 'factura', number: nextNumber('factura'), token: crypto.randomBytes(16).toString('hex'), payments: [], status: 'borrador', date: today(), dueDate: addDays(today(), 30), fromQuote: d.number, createdAt: new Date().toISOString() };
      d.status = 'aceptada';
      db.documents.push(inv); saveDb();
      return send(res, 201, enrich(inv));
    }
    if (action === 'duplicate' && m === 'POST') {
      const copy = { ...structuredClone(d), id: id(), number: nextNumber(d.type), token: crypto.randomBytes(16).toString('hex'), payments: [], status: 'borrador', date: today(), dueDate: addDays(today(), d.type === 'factura' ? 30 : 15), createdAt: new Date().toISOString() };
      delete copy.fromQuote;
      db.documents.push(copy); saveDb();
      return send(res, 201, enrich(copy));
    }
    if (action === 'payments' && m === 'POST') {
      const b = await readBody(req);
      if (num(b.amount) <= 0) return send(res, 400, { error: 'Monto inválido' });
      d.payments ||= [];
      d.payments.push({ id: id(), amount: num(b.amount), date: date(b.date, today()), method: str(b.method, 100) });
      saveDb(); return send(res, 201, enrich(d));
    }
  }

  // Resumen
  if (p === '/api/dashboard' && m === 'GET') {
    const month = today().slice(0, 7);
    const inv = db.documents.filter(d => d.type === 'factura').map(enrich).filter(d => d.computedStatus !== 'anulada');
    const sum = (arr, f) => arr.reduce((s, d) => s + f(d), 0);
    const monthly = {};
    const [cy, cm] = month.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(Date.UTC(cy, cm - 1 - i, 1));
      monthly[dt.toISOString().slice(0, 7)] = 0;
    }
    inv.forEach(d => { const k = d.date.slice(0, 7); if (k in monthly) monthly[k] += d.totals.total; });
    return send(res, 200, {
      billedThisMonth: sum(inv.filter(d => d.date.startsWith(month)), d => d.totals.total),
      receivable: sum(inv, d => Math.max(0, d.totals.balance)),
      overdue: sum(inv.filter(d => d.computedStatus === 'vencida'), d => d.totals.balance),
      overdueCount: inv.filter(d => d.computedStatus === 'vencida').length,
      openQuotes: db.documents.filter(d => d.type === 'cotizacion' && ['borrador', 'enviada'].includes(d.status)).length,
      clients: db.clients.length,
      monthly,
      recent: db.documents.map(enrich).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6)
    });
  }

  // Copia de seguridad
  if (p === '/api/backup' && m === 'GET') {
    const { auth, ...data } = db;
    return send(res, 200, data, { 'Content-Disposition': `attachment; filename="facturasimple-${today()}.json"` });
  }
  if (p === '/api/restore' && m === 'POST') {
    const b = await readBody(req, 20e6);
    if (!b || typeof b.settings !== 'object' || !Array.isArray(b.clients) || !Array.isArray(b.documents)) {
      return send(res, 400, { error: 'El archivo no es una copia de seguridad válida' });
    }
    // Guarda una copia del estado actual antes de reemplazarlo
    fs.writeFileSync(path.join(DATA_DIR, `antes-de-restaurar-${Date.now()}.json`), JSON.stringify(db));
    db.settings = { ...EMPTY_DB.settings, ...b.settings };
    db.clients = b.clients;
    db.documents = b.documents;
    saveDb();
    return send(res, 200, { ok: true, clients: db.clients.length, documents: db.documents.length });
  }

  return send(res, 404, { error: 'Ruta no encontrada' });
}

function cookieHeader(req, value) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `fs_session=${value}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; SameSite=Lax${secure}`;
}

// ---------- Archivos estáticos ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel.startsWith('/p/')) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Prohibido');
  fs.readFile(file, (err, buf) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => e2 ? send(res, 404, 'No encontrado') : res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html));
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- Vista pública del documento (enlace para el cliente) ----------
function publicDoc(res, token) {
  const d = db.documents.find(x => x.token === token);
  if (!d) return send(res, 404, { error: 'Documento no encontrado' });
  // Solo los datos que se ven en el documento impreso
  const s = db.settings;
  const settings = {};
  for (const k of ['businessName', 'taxId', 'address', 'phone', 'email', 'logoUrl', 'currency', 'locale', 'footer', 'paymentInfo', 'invoiceLabel']) settings[k] = s[k];
  const { token: _t, clientId: _c, createdAt: _a, ...doc } = enrich(d);
  const client = doc.client ? { name: doc.client.name, taxId: doc.client.taxId, address: doc.client.address, phone: doc.client.phone, email: doc.client.email } : null;
  return send(res, 200, { doc: { ...doc, client, payments: (doc.payments || []).map(({ amount, date }) => ({ amount, date })) }, settings });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    const pm = url.pathname.match(/^\/api\/public\/([a-f0-9]{32})$/);
    if (pm && req.method === 'GET') return publicDoc(res, pm[1]);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: e.message || 'Error' });
  }
});

server.listen(PORT, () => console.log(`FacturaSimple escuchando en http://localhost:${PORT}`));
