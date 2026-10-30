// ══════════════════════════════════════════
//  nc-features.js
//  Cruce de listas · Registro de trueques · Merge por cromo
//  Exportar PDF · Backup cifrado
//  Requiere index.html (STATE, save, esc, toast, pushUndo, addHistorial,
//  ID_RE, strCorto, sanitizarColecciones) con los parches aplicados.
// ══════════════════════════════════════════

const _norm = s => String(s ?? '').trim().replace(/^0+(?=\d)/, '');

// ── 1. CRUCE DE LISTAS ──────────────────────
// Lee el texto que genera el generador de WhatsApp (con o sin nombres, agrupado o no)
function parsearListaTexto(texto) {
  const res = { repetidos: [], faltas: [] };
  let seccion = null;
  for (const raw of String(texto).split(/\r?\n/)) {
    const linea = raw.trim();
    if (!linea) { seccion = null; continue; }
    const mayus = linea.toUpperCase();
    if (mayus.includes('REPETIDOS')) { seccion = 'repetidos'; continue; }
    if (mayus.includes('FALTAS'))    { seccion = 'faltas';    continue; }
    if (!seccion || mayus.includes('NINGUNO')) continue;
    for (const token of linea.split(',')) {
      const t = token.trim()
        .replace(/^_[^_]+:_\s*/, '')   // prefijo de equipo "_BARCELONA:_ 001"
        .replace(/\([^)]*\)/g, '')     // nombre entre paréntesis
        .replace(/x\d+$/i, '')         // cantidad "002x2"
        .trim();
      if (/^[A-Za-z0-9.\-]+$/.test(t)) res[seccion].push(_norm(t));
    }
  }
  return res;
}

function cruzarListas(col, otra) {
  const repDeEllos = new Set(otra.repetidos);
  const falDeEllos = new Set(otra.faltas);
  return {
    tePueden:  col.cromos.filter(c => c.tengo === false && repDeEllos.has(_norm(c.numero))),
    puedesDar: col.cromos.filter(c => c.tengo !== false && c.repetidos > 0 && falDeEllos.has(_norm(c.numero))),
  };
}

let _cruce = null;

function abrirCruce(colId) {
  const id = colId || STATE.currentColId;
  if (!STATE.colecciones.find(c => c.id === id)) { toast('Abre una colección primero', '⚠️'); return; }
  STATE.cruceColId = id;
  _cruce = null;
  document.getElementById('cruce-texto').value = '';
  document.getElementById('cruce-result').innerHTML = '';
  openModal('modal-cruce');
}

function ejecutarCruce() {
  const otra = parsearListaTexto(document.getElementById('cruce-texto').value);
  if (!otra.repetidos.length && !otra.faltas.length) { toast('No encuentro cromos en el texto', '⚠️'); return; }
  const col = STATE.colecciones.find(c => c.id === STATE.cruceColId);
  if (!col) return;
  _cruce = cruzarListas(col, otra);

  const fila = (c, tipo) => `<label class="wa-opt-label" style="padding:3px 0">
    <input type="checkbox" data-tipo="${tipo}" value="${esc(c.id)}" checked>
    <b>#${esc(c.numero)}</b> ${esc(c.nombre)}</label>`;
  const bloque = (titulo, arr, tipo) => `<h4 style="font-size:13px;margin:14px 0 6px">${titulo} (${arr.length})</h4>`
    + (arr.length ? arr.map(c => fila(c, tipo)).join('') : '<p style="color:var(--text3);font-size:13px">Ninguno</p>');

  document.getElementById('cruce-result').innerHTML =
    bloque('✅ Te pueden dar (te faltan)', _cruce.tePueden, 'recibe') +
    bloque('📤 Tú les puedes dar (repetidos que buscan)', _cruce.puedesDar, 'da') +
    `<div class="modal-actions" style="justify-content:flex-start;margin-top:12px">
       <button class="btn btn-green" onclick="confirmarTruequeDesdeCruce()">🤝 Registrar trueque</button>
     </div>`;
}

function confirmarTruequeDesdeCruce() {
  const marcados = tipo => [...document.querySelectorAll(`#cruce-result input[data-tipo="${tipo}"]:checked`)].map(i => i.value);
  const dio = marcados('da'), recibio = marcados('recibe');
  if (!dio.length && !recibio.length) { toast('Nada seleccionado', '⚠️'); return; }
  registrarTrueque(STATE.cruceColId, dio, recibio);
  closeModal('modal-cruce');
}

// ── 2. REGISTRO DE TRUEQUES ─────────────────
// Actualiza el inventario: −1 repetido por cada cromo dado, y falta→tengo o +1 repetido por cada recibido
function registrarTrueque(colId, dioIds, recibioIds, nota = '') {
  const col = STATE.colecciones.find(c => c.id === colId);
  if (!col) return;
  const dio = [], recibio = [];
  for (const id of dioIds) {
    const c = col.cromos.find(x => x.id === id);
    if (!c || !(c.repetidos > 0)) continue;
    c.repetidos--; dio.push({ numero: c.numero, nombre: c.nombre });
  }
  for (const id of recibioIds) {
    const c = col.cromos.find(x => x.id === id);
    if (!c) continue;
    if (c.tengo === false) c.tengo = true; else c.repetidos = (c.repetidos || 0) + 1;
    recibio.push({ numero: c.numero, nombre: c.nombre });
  }
  if (!dio.length && !recibio.length) { toast('Nada que registrar', '⚠️'); return; }
  pushUndo('Registrar trueque');
  col.trueques = [{ id: uid(), fecha: Date.now(), dio, recibio, nota: strCorto(nota, 200) }, ...(col.trueques || [])].slice(0, 500);
  addHistorial(colId, 'edit', `Trueque: diste ${dio.length}, recibiste ${recibio.length}`);
  save();
  renderCromos();
  toast(`Trueque registrado: diste ${dio.length}, recibiste ${recibio.length}`, '🤝');
}

function abrirTrueques() {
  const col = getCol(); if (!col) return;
  const lista = col.trueques || [];
  const nums = arr => arr.map(x => '#' + esc(x.numero)).join(' ') || '—';
  document.getElementById('trueques-list').innerHTML = lista.length
    ? lista.map(t => `<div class="hist-row">
        <span class="hist-badge edit">−${t.dio.length} / +${t.recibio.length}</span>
        <span style="flex:1;font-size:12px">${nums(t.dio)} ⇄ ${nums(t.recibio)}</span>
        <span class="hist-date">${new Date(t.fecha).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })}</span>
      </div>`).join('')
    : '<p style="color:var(--text3);font-size:13px">Sin trueques registrados.</p>';
  openModal('modal-trueques');
}

// ── 3. SINCRONIZACIÓN POR CROMO ─────────────
// Cada cromo y colección lleva modAt (último cambio). Las borrados se guardan
// como lápidas (tombstones) { cols:{id:ts}, cromos:{id:ts} }.
let _snapCols   = new Map();   // id → firma de colección
let _snapCromos = new Map();   // id → firma de cromo

function _firmaCol(c)   { return JSON.stringify([c.name, c.desc, c.emoji, c.tipo]); }
function _firmaCromo(c) { return JSON.stringify([c.numero, c.nombre, c.tipo, c.equipo, c.repetidos, c.tengo,
                                                  (c.fotoFront || '').length, (c.fotoBack || '').length]); }

function _snapshotReset() {
  _snapCols = new Map(STATE.colecciones.map(c => [c.id, _firmaCol(c)]));
  _snapCromos = new Map();
  for (const col of STATE.colecciones) for (const c of col.cromos) _snapCromos.set(c.id, _firmaCromo(c));
}

// Se llama desde save(): detecta qué cambió desde la última vez y lo marca con modAt
function _registrarCambios() {
  const ts = Date.now(), T = STATE.tombstones;
  const colsVistos = new Set(), cromosVistos = new Set();
  for (const col of STATE.colecciones) {
    colsVistos.add(col.id);
    const f = _firmaCol(col), prev = _snapCols.get(col.id);
    if (T.cols[col.id])          { delete T.cols[col.id]; col.modAt = ts; }   // reaparece (undo)
    else if (prev === undefined) { col.modAt = col.modAt || ts; }
    else if (prev !== f)         { col.modAt = ts; }
    _snapCols.set(col.id, f);

    for (const c of col.cromos) {
      cromosVistos.add(c.id);
      const fc = _firmaCromo(c), pc = _snapCromos.get(c.id);
      if (T.cromos[c.id])          { delete T.cromos[c.id]; c.modAt = ts; }
      else if (pc === undefined)   { c.modAt = c.modAt || ts; }
      else if (pc !== fc)          { c.modAt = ts; }
      _snapCromos.set(c.id, fc);
    }
  }
  for (const id of [..._snapCols.keys()])   if (!colsVistos.has(id))   { T.cols[id] = ts;   _snapCols.delete(id); }
  for (const id of [..._snapCromos.keys()]) if (!cromosVistos.has(id)) { T.cromos[id] = ts; _snapCromos.delete(id); }
}

function fusionarTombstones(a, b) {
  const out = { cols: {}, cromos: {} };
  for (const k of ['cols', 'cromos']) {
    for (const src of [a?.[k], b?.[k]]) {
      if (!src || typeof src !== 'object') continue;
      for (const [id, ts] of Object.entries(src)) {
        if (!ID_RE.test(id)) continue;
        out[k][id] = Math.max(out[k][id] || 0, Number(ts) || 0);
      }
    }
  }
  return out;
}

function sanitizarTrueques(arr) {
  const lista = a => Array.isArray(a)
    ? a.slice(0, 50).filter(x => x && typeof x === 'object').map(x => ({ numero: strCorto(x.numero, 20), nombre: strCorto(x.nombre, 200) }))
    : [];
  return Array.isArray(arr)
    ? arr.slice(0, 500).filter(t => t && typeof t === 'object').map(t => ({
        id: strCorto(t.id, 40), fecha: Number(t.fecha) || 0, dio: lista(t.dio), recibio: lista(t.recibio), nota: strCorto(t.nota, 200)
      }))
    : [];
}

// Un cromo gana el más reciente. Si se borró después de su última edición, desaparece.
function mergeCromos(lc, rc, Tc) {
  const L = new Map(lc.map(c => [c.id, c]));
  const R = new Map(rc.map(c => [c.id, c]));
  const out = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);
    const mod = Math.max(l?.modAt || 0, r?.modAt || 0);
    if (Tc[id] && Tc[id] >= mod) continue;
    out.push(l && r ? ((r.modAt || 0) > (l.modAt || 0) ? r : l) : (l || r));
  }
  return out;
}

function mergeEstado(localCols, remoteCols, T) {
  const L = new Map(localCols.map(c => [c.id, c]));
  const R = new Map(remoteCols.map(c => [c.id, c]));
  const out = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);
    const mod = Math.max(l?.modAt || 0, r?.modAt || 0);
    if (T.cols[id] && T.cols[id] >= mod) continue;
    const base = l && r ? ((r.modAt || 0) > (l.modAt || 0) ? r : l) : (l || r);
    const trs = new Map([...(l?.trueques || []), ...(r?.trueques || [])].map(t => [t.id, t]));
    out.push({
      ...base,
      trueques: [...trs.values()].sort((a, b) => b.fecha - a.fecha).slice(0, 500),
      cromos: mergeCromos(l?.cromos || [], r?.cromos || [], T.cromos),
    });
  }
  return out;
}

// ── 4. EXPORTAR PDF ─────────────────────────
// Usa el diálogo de impresión del navegador: "Guardar como PDF"
function exportarPDF(colId) {
  const col = STATE.colecciones.find(c => c.id === (colId || STATE.currentColId));
  if (!col) return;
  const porNum = (a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true, sensitivity: 'base' });
  const reps   = col.cromos.filter(c => c.tengo !== false && c.repetidos > 0).sort(porNum);
  const faltas = col.cromos.filter(c => c.tengo === false).sort(porNum);
  const tabla = (titulo, arr) => `<h2>${esc(titulo)} (${arr.length})</h2>` + (arr.length
    ? `<table><thead><tr><th>Nº</th><th>Nombre</th><th>Equipo</th><th>Rep.</th></tr></thead><tbody>${
        arr.map(c => `<tr><td>${esc(c.numero)}</td><td>${esc(c.nombre)}</td><td>${esc(c.equipo || '')}</td><td>${c.repetidos > 0 ? c.repetidos : ''}</td></tr>`).join('')
      }</tbody></table>`
    : '<p>Ninguno</p>');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(col.name)}</title>
<style>body{font-family:Arial,sans-serif;color:#000;margin:20px}h1{font-size:20px;margin-bottom:4px}
h2{font-size:15px;margin:18px 0 6px}table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border-bottom:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#eee}</style></head>
<body><h1>${esc(col.emoji)} ${esc(col.name)}</h1>
<p>Total: ${col.cromos.length} · Tengo: ${col.cromos.length - faltas.length} · Faltan: ${faltas.length} · Repetidos: ${reps.length}</p>
${tabla('Repetidos (disponibles)', reps)}${tabla('Faltas', faltas)}</body></html>`;

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  frame.srcdoc = html;                       // antes de añadirlo al DOM
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 2000);
  };
  document.body.appendChild(frame);
}

// ── 5. BACKUP CIFRADO (AES-GCM + PBKDF2) ────
const _enc = new TextEncoder(), _dec = new TextDecoder();
const _ITER = 310000;

function _toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function _fromB64(s) { return Uint8Array.from(atob(s), ch => ch.charCodeAt(0)); }

async function _derivarClave(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', _enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function cifrarBackup(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await _derivarClave(pass, salt, _ITER);
  const plain = _enc.encode(JSON.stringify({ colecciones: STATE.colecciones, tombstones: STATE.tombstones }));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return JSON.stringify({
    formato: 'naarro-enc', v: 1, iter: _ITER,
    salt: _toB64(salt), iv: _toB64(iv), data: _toB64(new Uint8Array(cipher))
  });
}

async function descifrarBackup(texto, pass) {
  const o = JSON.parse(texto);
  const iter = Math.min(Math.max(Number(o.iter) || _ITER, 100000), 1000000);
  const key = await _derivarClave(pass, _fromB64(o.salt), iter);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _fromB64(o.iv) }, key, _fromB64(o.data));
  return JSON.parse(_dec.decode(plain));
}

async function descargarBackupCifrado() {
  const p1 = prompt('Elige una contraseña (mínimo 8 caracteres). Si la pierdes, la copia no se puede recuperar:');
  if (!p1 || p1.length < 8) { toast('Contraseña demasiado corta', '⚠️'); return; }
  const p2 = prompt('Repite la contraseña:');
  if (p1 !== p2) { toast('Las contraseñas no coinciden', '❌'); return; }
  const txt = await cifrarBackup(p1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
  a.download = 'naarros_backup_cifrado.json';
  a.click();
  toast('Copia cifrada descargada 🔐');
}

// Carga un JSON plano (formato antiguo) o cifrado. Devuelve false si el usuario cancela.
async function cargarArchivoBackup(texto) {
  const o = JSON.parse(texto);
  if (Array.isArray(o)) {
    const limpio = sanitizarColecciones(o);
    if (!limpio) throw new Error('Formato incorrecto');
    STATE.colecciones = limpio;
  } else if (o && o.formato === 'naarro-enc') {
    const pass = prompt('Contraseña de la copia:');
    if (!pass) return false;
    let d;
    try { d = await descifrarBackup(texto, pass); }
    catch { throw new Error('Contraseña incorrecta o copia dañada'); }
    STATE.colecciones = sanitizarColecciones(d.colecciones) || [];
    STATE.tombstones  = fusionarTombstones(d.tombstones, null);
  } else {
    throw new Error('Formato incorrecto');
  }
  // Las fotos del archivo no están en Drive: marcarlas para subir
  STATE.colecciones.forEach(col => {
    if (col.cromos.some(c => c.fotoFront || c.fotoBack)) window.driveMarkPhotosDirty?.(col.id);
  });
  save();
  renderHome();
  toast('Archivo cargado correctamente ✅');
  return true;
}