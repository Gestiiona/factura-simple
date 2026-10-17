// FacturaSimple — interfaz (JavaScript sin frameworks)
'use strict';
const $app = document.getElementById('app');
let settings = null;

// ---------- Utilidades ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Fecha local del navegador (no UTC), en formato AAAA-MM-DD
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DIAN_NOTE = 'FacturaSimple genera cotizaciones, cuentas de cobro y documentos de cobro en PDF. No emite factura electrónica de venta ante la DIAN ni ante otras autoridades tributarias. Si tu negocio está obligado a facturar electrónicamente, usa un proveedor autorizado para eso.';
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
function money(n, s = settings) {
  try { return new Intl.NumberFormat(s?.locale || 'es-CO', { style: 'currency', currency: s?.currency || 'COP', maximumFractionDigits: (s?.currency || 'COP') === 'COP' ? 0 : 2 }).format(n || 0); }
  catch { return (n || 0).toFixed(2); }
}
function fmtDate(d) { if (!d) return ''; const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; }
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2500); }
async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) { location.hash = '#/login'; throw new Error('No autorizado'); }
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}
const STATUS_LABEL = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', anulada: 'Anulada', pagada: 'Pagada', vencida: 'Vencida', abonada: 'Abono parcial' };
const badge = s => `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
const typeLabel = (t, s = settings) => t === 'factura' ? (s?.invoiceLabel || 'Cuenta de cobro') : 'Cotización';
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

// ---------- Layout ----------
function shell(active, content) {
  const link = (h, label, key) => `<a href="${h}" class="${active === key ? 'active' : ''}">${label}</a>`;
  $app.innerHTML = `<div class="layout">
    <nav class="side">
      <div class="brand"><img src="/icon.svg" alt="">FacturaSimple</div>
      ${link('#/', 'Inicio', 'home')}
      ${link('#/facturas', 'Cobros', 'factura')}
      ${link('#/cotizaciones', 'Cotizaciones', 'cotizacion')}
      ${link('#/clientes', 'Clientes', 'clientes')}
      ${link('#/ajustes', 'Ajustes', 'ajustes')}
      <div class="spacer"></div>
      <a href="#" id="logout">Cerrar sesión</a>
    </nav>
    <main>${content}</main></div>`;
  document.getElementById('logout').onclick = async e => { e.preventDefault(); await api('/api/logout', { method: 'POST' }); location.hash = '#/login'; };
}

// ---------- Pantallas de acceso ----------
function viewSetup() {
  $app.innerHTML = `<div class="auth card">
    <h1>Bienvenido a FacturaSimple</h1>
    <p class="muted">Configura tu negocio y crea una contraseña de administrador.</p>
    <form id="f">
      <div class="field"><label>Código de configuración</label><input name="setupCode" required autocomplete="off" placeholder="Aparece en los registros (logs) del servidor"></div>
      <div class="field"><label>Nombre del negocio</label><input name="businessName" required></div>
      <div class="field"><label>Contraseña (mínimo 8 caracteres)</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn primary" style="width:100%">Empezar</button>
    </form>
    <p class="muted" style="font-size:.8rem;margin-top:1rem">${DIAN_NOTE}</p></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/setup', { method: 'POST', body: formData(e.target) }); location.hash = '#/ajustes'; route(); toast('¡Listo! Completa los datos de tu negocio.'); }
    catch (err) { toast(err.message); }
  };
}
function viewLogin() {
  $app.innerHTML = `<div class="auth card">
    <div class="row" style="margin-bottom:1rem"><img src="/icon.svg" width="36" alt=""><h1 style="margin:0">FacturaSimple</h1></div>
    <form id="f">
      <div class="field"><label>Contraseña</label><input name="password" type="password" required autofocus autocomplete="current-password"></div>
      <button class="btn primary" style="width:100%">Entrar</button>
    </form></div>`;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: formData(e.target) }); location.hash = '#/'; }
    catch (err) { toast(err.message); }
  };
}

// ---------- Inicio ----------
async function viewHome() {
  const d = await api('/api/dashboard');
  const max = Math.max(1, ...Object.values(d.monthly));
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  shell('home', `
    <div class="row between"><h1>Inicio</h1>
      <div class="row"><a class="btn" href="#/nuevo/cotizacion">+ Cotización</a><a class="btn primary" href="#/nuevo/factura">+ ${esc(typeLabel('factura'))}</a></div></div>
    <div class="grid stats">
      <div class="card stat"><div class="label">Emitido este mes</div><div class="value">${money(d.billedThisMonth)}</div></div>
      <div class="card stat"><div class="label">Por cobrar</div><div class="value">${money(d.receivable)}</div></div>
      <div class="card stat"><div class="label">Vencido (${d.overdueCount})</div><div class="value" style="${d.overdue > 0 ? 'color:var(--danger)' : ''}">${money(d.overdue)}</div></div>
      <div class="card stat"><div class="label">Cotizaciones abiertas</div><div class="value">${d.openQuotes}</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h2>Emitido en los últimos 6 meses</h2>
        <div class="bars">${Object.entries(d.monthly).map(([k, v]) => `<div class="bar" title="${money(v)}"><div style="height:${(v / max) * 100}%"></div><span>${months[Number(k.slice(5)) - 1]}</span></div>`).join('')}</div></div>
      <div class="card"><h2>Actividad reciente</h2>
        ${d.recent.length ? `<table>${d.recent.map(r => `<tr class="click" data-id="${r.id}"><td>${esc(r.number)}<div class="muted">${esc(r.client?.name || '—')}</div></td><td class="num">${money(r.totals.total)}<div>${badge(r.computedStatus)}</div></td></tr>`).join('')}</table>`
          : `<div class="empty">Aún no hay documentos.<br><a href="#/nuevo/cotizacion">Crea tu primera cotización</a></div>`}
      </div>
    </div>`);
  document.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => location.hash = '#/ver/' + tr.dataset.id);
}

// ---------- Listado de documentos ----------
async function viewList(type) {
  const docs = await api('/api/documents?type=' + type);
  const title = type === 'factura' ? 'Cobros' : 'Cotizaciones';
  shell(type, `
    <div class="row between"><h1>${title}</h1><a class="btn primary" href="#/nuevo/${type}">+ ${esc(typeLabel(type))}</a></div>
    <div class="card">
      <input id="q" placeholder="Buscar por número o cliente…" style="margin-bottom:.75rem">
      <div class="table-wrap"><table>
        <thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th class="num">Total</th>${type === 'factura' ? '<th class="num">Saldo</th>' : ''}</tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`);
  const render = q => {
    const list = docs.filter(d => !q || (d.number + ' ' + (d.client?.name || '')).toLowerCase().includes(q.toLowerCase()));
    document.getElementById('rows').innerHTML = list.length ? list.map(d => `<tr class="click" data-id="${d.id}">
      <td><strong>${esc(d.number)}</strong></td><td>${esc(d.client?.name || '—')}</td><td>${fmtDate(d.date)}</td><td>${badge(d.computedStatus)}</td>
      <td class="num">${money(d.totals.total)}</td>${type === 'factura' ? `<td class="num">${money(d.totals.balance)}</td>` : ''}</tr>`).join('')
      : `<tr><td colspan="6" class="empty">No hay ${title.toLowerCase()} todavía.</td></tr>`;
    document.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => location.hash = '#/ver/' + tr.dataset.id);
  };
  render('');
  document.getElementById('q').oninput = e => render(e.target.value);
}

// ---------- Clientes ----------
async function viewClients() {
  const clients = await api('/api/clients');
  shell('clientes', `
    <div class="row between"><h1>Clientes</h1><button class="btn primary" id="add">+ Nuevo cliente</button></div>
    <div class="card" id="formCard" style="display:none"></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>NIT / CC</th><th>Teléfono</th><th>Email</th><th></th></tr></thead>
      <tbody>${clients.length ? clients.map(c => `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.taxId)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td>
        <td class="num"><button class="btn sm" data-edit="${c.id}">Editar</button> <button class="btn sm danger" data-del="${c.id}">Eliminar</button></td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">Agrega tu primer cliente.</td></tr>'}</tbody></table></div></div>`);
  const showForm = c => {
    const fc = document.getElementById('formCard');
    fc.style.display = 'block';
    fc.innerHTML = clientForm(c);
    fc.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      try {
        await api(c ? '/api/clients/' + c.id : '/api/clients', { method: c ? 'PUT' : 'POST', body: formData(e.target) });
        toast('Cliente guardado'); viewClients();
      } catch (err) { toast(err.message); }
    };
    fc.querySelector('[data-cancel]').onclick = () => { fc.style.display = 'none'; };
    fc.querySelector('input').focus();
  };
  document.getElementById('add').onclick = () => showForm(null);
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => showForm(clients.find(c => c.id === b.dataset.edit)));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar este cliente?')) return;
    try { await api('/api/clients/' + b.dataset.del, { method: 'DELETE' }); toast('Cliente eliminado'); viewClients(); } catch (err) { toast(err.message); }
  });
}
function clientForm(c = {}) {
  c ||= {};
  return `<form><h2>${c.id ? 'Editar cliente' : 'Nuevo cliente'}</h2>
    <div class="grid cols-2">
      <div class="field"><label>Nombre o razón social *</label><input name="name" required value="${esc(c.name)}"></div>
      <div class="field"><label>NIT / CC</label><input name="taxId" value="${esc(c.taxId)}"></div>
      <div class="field"><label>Teléfono / WhatsApp</label><input name="phone" value="${esc(c.phone)}" placeholder="+57 300 000 0000"></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(c.email)}"></div>
    </div>
    <div class="field"><label>Dirección</label><input name="address" value="${esc(c.address)}"></div>
    <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" data-cancel>Cancelar</button></div></form>`;
}

// ---------- Editor de documentos ----------
async function viewEditor(type, docId) {
  const [clients, doc] = await Promise.all([api('/api/clients'), docId ? api('/api/documents/' + docId) : null]);
  type = doc?.type || type;
  const d = doc || { type, date: today(), dueDate: addDays(today(), type === 'factura' ? 30 : 15), items: [{ description: '', qty: 1, price: 0, tax: settings.defaultTax }], discount: 0, notes: '', status: 'borrador', clientId: '' };
  shell(type, `
    <div class="row between"><h1>${doc ? `Editar ${esc(doc.number)}` : `Crear ${esc(typeLabel(type).toLowerCase())}`}</h1></div>
    <form id="f">
      <div class="card"><div class="grid cols-2">
        <div class="field"><label>Cliente</label>
          <select name="clientId" id="client"><option value="">— Selecciona un cliente —</option>
            ${clients.map(c => `<option value="${c.id}" ${c.id === d.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            <option value="__new">+ Crear cliente nuevo…</option></select></div>
        <div class="field"><label>Estado</label><select name="status">
          ${['borrador', 'enviada', ...(type === 'cotizacion' ? ['aceptada', 'rechazada'] : []), 'anulada'].map(s => `<option value="${s}" ${s === d.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select></div>
        <div class="field"><label>Fecha</label><input type="date" name="date" value="${esc(d.date)}"></div>
        <div class="field"><label>${type === 'factura' ? 'Fecha de vencimiento' : 'Válida hasta'}</label><input type="date" name="dueDate" value="${esc(d.dueDate)}"></div>
      </div><div id="newClient"></div></div>
      <div class="card"><h2>Productos o servicios</h2>
        <div class="table-wrap"><table class="items"><thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio unit.</th><th class="num">IVA %</th><th class="num">Total</th><th></th></tr></thead>
        <tbody id="items"></tbody></table></div>
        <button type="button" class="btn sm" id="addItem" style="margin-top:.5rem">+ Agregar línea</button>
        <div class="row" style="margin-top:1rem;align-items:flex-start">
          <div style="flex:1;min-width:240px"><label>Notas / condiciones</label><textarea name="notes" placeholder="Ej: 50% anticipo, entrega en 5 días hábiles.">${esc(d.notes)}</textarea></div>
          <div class="totals" id="totals"></div>
        </div>
      </div>
      <div class="row"><button class="btn primary">Guardar</button><a class="btn" href="${doc ? '#/ver/' + doc.id : '#/' + (type === 'factura' ? 'facturas' : 'cotizaciones')}">Cancelar</a></div>
    </form>`);

  let items = structuredClone(d.items);
  let discount = Number(d.discount) || 0;
  const tbody = document.getElementById('items');
  const renderTotals = () => {
    let sub = 0, tax = 0;
    items.forEach(it => { const l = (+it.qty || 0) * (+it.price || 0); sub += l; tax += l * (+it.tax || 0) / 100; });
    document.getElementById('totals').innerHTML = `
      <div><span>Subtotal</span><span>${money(sub)}</span></div>
      <div><span>Descuento</span><span><input type="number" step="any" min="0" id="discount" value="${discount}" style="width:130px;text-align:right"></span></div>
      <div><span>IVA</span><span>${money(tax)}</span></div>
      <div class="grand"><span>Total</span><span>${money(sub - discount + tax)}</span></div>`;
    const di = document.getElementById('discount');
    di.onchange = () => { discount = +di.value || 0; renderTotals(); };
    tbody.querySelectorAll('tr').forEach((tr, i) => { tr.querySelector('.lt').textContent = money((+items[i].qty || 0) * (+items[i].price || 0)); });
  };
  const renderItems = () => {
    tbody.innerHTML = items.map((it, i) => `<tr data-i="${i}">
      <td><input data-k="description" value="${esc(it.description)}" placeholder="Descripción"></td>
      <td><input data-k="qty" type="number" step="any" value="${esc(it.qty)}" style="width:80px;text-align:right"></td>
      <td><input data-k="price" type="number" step="any" value="${esc(it.price)}" style="width:130px;text-align:right"></td>
      <td><input data-k="tax" type="number" step="any" value="${esc(it.tax)}" style="width:70px;text-align:right"></td>
      <td class="num lt"></td>
      <td><button type="button" class="btn sm danger" data-rm="${i}" aria-label="Quitar línea">✕</button></td></tr>`).join('');
    tbody.querySelectorAll('input').forEach(inp => inp.oninput = () => {
      const i = +inp.closest('tr').dataset.i; items[i][inp.dataset.k] = inp.dataset.k === 'description' ? inp.value : inp.value; renderTotals();
    });
    tbody.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); if (!items.length) items.push({ description: '', qty: 1, price: 0, tax: settings.defaultTax }); renderItems(); });
    renderTotals();
  };
  renderItems();
  document.getElementById('addItem').onclick = () => { items.push({ description: '', qty: 1, price: 0, tax: settings.defaultTax }); renderItems(); tbody.lastElementChild.querySelector('input').focus(); };

  const sel = document.getElementById('client');
  sel.onchange = () => {
    if (sel.value !== '__new') return;
    const box = document.getElementById('newClient');
    box.innerHTML = `<div class="card" style="box-shadow:none">${clientForm(null).replace('<form>', '<div id="nc">').replace('</form>', '</div>').replace('<button class="btn primary">', '<button type="button" class="btn primary" id="saveNc">')}</div>`;
    box.querySelector('[data-cancel]').onclick = () => { box.innerHTML = ''; sel.value = ''; };
    document.getElementById('saveNc').onclick = async () => {
      const body = {}; box.querySelectorAll('input').forEach(i => body[i.name] = i.value);
      try {
        const c = await api('/api/clients', { method: 'POST', body });
        sel.insertAdjacentHTML('afterbegin', `<option value="${c.id}">${esc(c.name)}</option>`); sel.value = c.id; box.innerHTML = ''; toast('Cliente creado');
      } catch (err) { toast(err.message); }
    };
  };

  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    const fd = formData(e.target);
    if (fd.clientId === '__new') fd.clientId = '';
    if (!fd.clientId) return toast('Selecciona un cliente');
    const body = { ...fd, type, items: items.filter(it => it.description || +it.price), discount };
    if (!body.items.length) return toast('Agrega al menos una línea');
    try {
      const saved = await api(doc ? '/api/documents/' + doc.id : '/api/documents', { method: doc ? 'PUT' : 'POST', body });
      toast('Guardado'); location.hash = '#/ver/' + saved.id;
    } catch (err) { toast(err.message); }
  };
}

// ---------- Vista del documento (imprimible) ----------
function paperHtml(d, s) {
  const c = d.client || {};
  const t = d.totals;
  return `<div class="paper">
    <div class="head">
      <div>${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="">` : ''}
        <div style="font-weight:700;font-size:1.1rem">${esc(s.businessName)}</div>
        <div class="small">${[s.taxId && 'NIT: ' + s.taxId, s.address, s.phone, s.email].filter(Boolean).map(esc).join('\n')}</div></div>
      <div class="doc-title"><h1>${esc(typeLabel(d.type, s))}</h1><div style="font-weight:700">${esc(d.number)}</div>
        <div class="small">Fecha: ${fmtDate(d.date)}${d.dueDate ? `\n${d.type === 'factura' ? 'Vence' : 'Válida hasta'}: ${fmtDate(d.dueDate)}` : ''}${d.fromQuote ? `\nRef. cotización: ${esc(d.fromQuote)}` : ''}</div></div>
    </div>
    <div style="margin-bottom:1.5rem"><div class="small" style="text-transform:uppercase;letter-spacing:.05em">Cliente</div>
      <div style="font-weight:700">${esc(c.name || '—')}</div>
      <div class="small">${[c.taxId && 'NIT/CC: ' + c.taxId, c.address, c.phone, c.email].filter(Boolean).map(esc).join('\n')}</div></div>
    <table><thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">IVA</th><th class="num">Total</th></tr></thead>
      <tbody>${d.items.map(it => `<tr><td style="white-space:pre-line">${esc(it.description)}</td><td class="num">${esc(it.qty)}</td><td class="num">${money(it.price, s)}</td><td class="num">${esc(it.tax)}%</td><td class="num">${money(it.qty * it.price, s)}</td></tr>`).join('')}</tbody></table>
    <div class="totals" style="margin-top:1rem">
      <div><span>Subtotal</span><span>${money(t.subtotal, s)}</span></div>
      ${t.discount ? `<div><span>Descuento</span><span>-${money(t.discount, s)}</span></div>` : ''}
      <div><span>IVA</span><span>${money(t.tax, s)}</span></div>
      <div class="grand"><span>Total</span><span>${money(t.total, s)}</span></div>
      ${d.type === 'factura' && t.paid ? `<div><span>Pagado</span><span>${money(t.paid, s)}</span></div><div style="font-weight:700"><span>Saldo</span><span>${money(t.balance, s)}</span></div>` : ''}
    </div>
    ${d.notes ? `<div style="margin-top:1.5rem"><div class="small" style="text-transform:uppercase;letter-spacing:.05em">Notas</div><div class="small" style="color:#111">${esc(d.notes)}</div></div>` : ''}
    ${s.paymentInfo ? `<div style="margin-top:1rem"><div class="small" style="text-transform:uppercase;letter-spacing:.05em">Datos de pago</div><div class="small" style="color:#111">${esc(s.paymentInfo)}</div></div>` : ''}
    ${s.footer ? `<div class="small" style="text-align:center;margin-top:2rem">${esc(s.footer)}</div>` : ''}
    ${d.type === 'factura' && /factura/i.test(s.invoiceLabel || '') ? '<div class="small" style="text-align:center;margin-top:.5rem;font-size:.75rem">Este documento no es una factura electrónica de venta.</div>' : ''}
  </div>`;
}

async function viewDoc(docId) {
  const d = await api('/api/documents/' + docId);
  const publicUrl = `${location.origin}/p/${d.token}`;
  const phone = (d.client?.phone || '').replace(/\D/g, '');
  const waText = `Hola ${d.client?.name || ''}, te comparto: ${typeLabel(d.type)} ${d.number} por ${money(d.totals.total)}. Puedes verla y descargarla aquí: ${publicUrl}`;
  shell(d.type, `
    <div class="toolbar">
      <div class="row between" style="margin-bottom:.75rem"><div class="row"><a href="#/${d.type === 'factura' ? 'facturas' : 'cotizaciones'}">← Volver</a> ${badge(d.computedStatus)}</div></div>
      <div class="row">
        <button class="btn primary" id="print">Descargar PDF / Imprimir</button>
        <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${encodeURIComponent(waText)}">Enviar por WhatsApp</a>
        <button class="btn" id="copy">Copiar enlace</button>
        <a class="btn" href="#/editar/${d.id}">Editar</a>
        ${d.type === 'cotizacion' ? '<button class="btn" id="convert">Convertir en factura</button>' : ''}
        ${d.type === 'factura' && d.totals.balance > 0 ? '<button class="btn" id="pay">Registrar pago</button>' : ''}
        <button class="btn" id="dup">Duplicar</button>
        <button class="btn danger" id="del">Eliminar</button>
      </div>
      <div id="payBox"></div>
    </div>
    ${paperHtml(d, settings)}
    ${d.payments?.length ? `<div class="card no-print" style="max-width:820px;margin:1rem auto"><h2>Pagos</h2><table>${d.payments.map(p => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.method)}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</table></div>` : ''}`);
  document.getElementById('print').onclick = () => window.print();
  document.getElementById('copy').onclick = async () => { try { await navigator.clipboard.writeText(publicUrl); toast('Enlace copiado'); } catch { prompt('Copia el enlace:', publicUrl); } };
  document.getElementById('dup').onclick = async () => { const c = await api(`/api/documents/${d.id}/duplicate`, { method: 'POST' }); toast('Duplicado'); location.hash = '#/editar/' + c.id; };
  document.getElementById('del').onclick = async () => {
    if (!confirm(`¿Eliminar ${d.number}? Esta acción no se puede deshacer.`)) return;
    await api('/api/documents/' + d.id, { method: 'DELETE' }); toast('Eliminado'); location.hash = d.type === 'factura' ? '#/facturas' : '#/cotizaciones';
  };
  const conv = document.getElementById('convert');
  if (conv) conv.onclick = async () => { const inv = await api(`/api/documents/${d.id}/convert`, { method: 'POST' }); toast('Factura creada'); location.hash = '#/ver/' + inv.id; };
  const pay = document.getElementById('pay');
  if (pay) pay.onclick = () => {
    const box = document.getElementById('payBox');
    box.innerHTML = `<form class="card" style="margin-top:1rem"><div class="grid cols-2">
      <div class="field"><label>Monto</label><input name="amount" type="number" step="any" value="${d.totals.balance}" required></div>
      <div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}"></div>
      <div class="field"><label>Método</label><input name="method" placeholder="Transferencia, Nequi, efectivo…"></div></div>
      <button class="btn primary">Guardar pago</button></form>`;
    box.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      try { await api(`/api/documents/${d.id}/payments`, { method: 'POST', body: formData(e.target) }); toast('Pago registrado'); viewDoc(d.id); } catch (err) { toast(err.message); }
    };
  };
}

async function viewPublic(token) {
  try {
    const { doc, settings: s } = await fetch('/api/public/' + token).then(r => { if (!r.ok) throw new Error(); return r.json(); });
    document.title = `${typeLabel(doc.type, s)} ${doc.number} — ${s.businessName}`;
    $app.innerHTML = `<main style="margin:0 auto">
      <div class="toolbar row"><button class="btn primary" onclick="window.print()">Descargar PDF / Imprimir</button></div>
      ${paperHtml(doc, s)}</main>`;
  } catch { $app.innerHTML = '<div class="auth card"><h1>Documento no encontrado</h1><p class="muted">El enlace no es válido o fue eliminado.</p></div>'; }
}

// ---------- Ajustes ----------
async function viewSettings() {
  const s = settings = await api('/api/settings');
  const f = (name, label, attrs = '') => `<div class="field"><label>${label}</label><input name="${name}" value="${esc(s[name])}" ${attrs}></div>`;
  shell('ajustes', `<h1>Ajustes</h1>
    <form id="f" class="card"><h2>Datos del negocio</h2>
      <div class="grid cols-2">
        ${f('businessName', 'Nombre del negocio', 'required')}${f('taxId', 'NIT / RUT')}
        ${f('phone', 'Teléfono')}${f('email', 'Email', 'type="email"')}
        ${f('address', 'Dirección')}${f('logoUrl', 'URL del logo (opcional)', 'placeholder="https://…"')}
      </div>
      <h2 style="margin-top:1rem">Preferencias</h2>
      <div class="grid cols-2">
        <div class="field"><label>Moneda</label><select name="currency">${['COP', 'MXN', 'USD', 'EUR', 'PEN', 'CLP', 'ARS', 'GTQ', 'DOP', 'CRC', 'BOB', 'UYU', 'PYG'].map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Formato regional</label><select name="locale">${[['es-CO', 'Colombia'], ['es-MX', 'México'], ['es-ES', 'España'], ['es-PE', 'Perú'], ['es-CL', 'Chile'], ['es-AR', 'Argentina'], ['en-US', 'Estados Unidos']].map(([v, l]) => `<option value="${v}" ${v === s.locale ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Nombre del documento de cobro</label><select name="invoiceLabel">${['Cuenta de cobro', 'Factura', 'Recibo', 'Remisión', 'Nota de cobro'].map(v => `<option ${v === s.invoiceLabel ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Zona horaria</label><select name="timezone">${['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Caracas', 'America/Guayaquil', 'America/Panama', 'America/Santo_Domingo', 'America/Guatemala', 'America/Costa_Rica', 'America/Montevideo', 'America/Asuncion', 'America/La_Paz', 'America/New_York', 'Europe/Madrid'].map(v => `<option ${v === s.timezone ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${f('defaultTax', 'IVA por defecto (%)', 'type="number" step="any"')}
        ${f('invoicePrefix', 'Prefijo de facturas')}${f('nextInvoice', 'Siguiente número de factura', 'type="number" min="1"')}
        ${f('quotePrefix', 'Prefijo de cotizaciones')}${f('nextQuote', 'Siguiente número de cotización', 'type="number" min="1"')}
      </div>
      <div class="field"><label>Datos de pago (aparecen en el documento)</label><textarea name="paymentInfo" placeholder="Bancolombia ahorros 000-000000-00 · Nequi 300 000 0000">${esc(s.paymentInfo)}</textarea></div>
      <div class="field"><label>Pie de página</label><input name="footer" value="${esc(s.footer)}"></div>
      <button class="btn primary">Guardar ajustes</button>
    </form>
    <form id="pw" class="card"><h2>Cambiar contraseña</h2><div class="grid cols-2">
      <div class="field"><label>Contraseña actual</label><input name="current" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div></div>
      <button class="btn">Actualizar contraseña</button></form>
    <div class="card"><h2>Copia de seguridad</h2><p class="muted">Descarga todos tus clientes y documentos en un archivo JSON. Hazlo con frecuencia, sobre todo antes de actualizar o mover la app.</p>
      <div class="row"><a class="btn" href="/api/backup">Descargar copia</a>
      <label class="btn" style="margin:0;color:var(--text)">Restaurar desde archivo…<input type="file" id="restore" accept="application/json,.json" hidden></label></div></div>
    <div class="card"><h2>Aviso importante</h2><p class="muted">${DIAN_NOTE}</p></div>`);
  document.getElementById('restore').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('Esto reemplazará todos los clientes y documentos actuales por los del archivo. Se guardará una copia del estado actual en el servidor. ¿Continuar?')) { e.target.value = ''; return; }
    try {
      const data = JSON.parse(await file.text());
      const r = await api('/api/restore', { method: 'POST', body: data });
      settings = null; toast(`Restaurado: ${r.clients} clientes, ${r.documents} documentos`); setTimeout(() => route(), 800);
    } catch (err) { toast(err.message.includes('JSON') ? 'El archivo no es válido' : err.message); e.target.value = ''; }
  };
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try { settings = await api('/api/settings', { method: 'PUT', body: formData(e.target) }); toast('Ajustes guardados'); } catch (err) { toast(err.message); }
  };
  document.getElementById('pw').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/password', { method: 'PUT', body: formData(e.target) }); e.target.reset(); toast('Contraseña actualizada'); } catch (err) { toast(err.message); }
  };
}

// ---------- Router ----------
async function route() {
  const pub = location.pathname.match(/^\/p\/([a-f0-9]{32})$/);
  if (pub) return viewPublic(pub[1]);
  const st = await fetch('/api/status').then(r => r.json());
  if (st.setup) return viewSetup();
  const h = location.hash.slice(1) || '/';
  if (!st.authed) return viewLogin();
  if (h === '/login') { location.hash = '#/'; return; }
  if (!settings) settings = await api('/api/settings');
  try {
    let m;
    if (h === '/') return await viewHome();
    if (h === '/facturas') return await viewList('factura');
    if (h === '/cotizaciones') return await viewList('cotizacion');
    if (h === '/clientes') return await viewClients();
    if (h === '/ajustes') return await viewSettings();
    if ((m = h.match(/^\/nuevo\/(factura|cotizacion)$/))) return await viewEditor(m[1]);
    if ((m = h.match(/^\/editar\/([a-f0-9]+)$/))) return await viewEditor(null, m[1]);
    if ((m = h.match(/^\/ver\/([a-f0-9]+)$/))) return await viewDoc(m[1]);
    location.hash = '#/';
  } catch (err) { if (err.message !== 'No autorizado') toast(err.message); }
}
window.addEventListener('hashchange', route);
route();
