// ══════════════════════════════════════════
//  nc-features.js
//  Cruce de listas · Registro de trueques · Merge por cromo
//  Exportar PDF · Backup cifrado
//  Requiere index.html (STATE, save, esc, toast, pushUndo, addHistorial,
//  ID_RE, strCorto, sanitizarColecciones) con los parches aplicados.
// ══════════════════════════════════════════

const _norm = s => String(s ?? '').trim().replace(/^0+(?=\d)/, '');

// ══ CRUCE Y TRUEQUES ══════════════════════════
// Estados: 'prep' (reservas, sin tocar inventario) → 'envio' (bloqueado) → 'final' (aplicado y cerrado)
const PLAZO_HISTORIAL_MS = 60 * 24 * 3600 * 1000;   // 2 meses desde que se finalizó
const ESTADOS = { prep: 'Preparación', envio: 'Enviado', final: 'Finalizado' };
const COLOR_ESTADO = { prep: 'var(--yellow)', envio: 'var(--accent2)', final: 'var(--green)' };

let _cruceSel = [];       // ids de colecciones marcadas
let _cruceTxt = null;     // texto de las líneas { recibe: {colId: txt}, da: {colId: txt} }
let _cruceResult = null;  // plan calculado para la confirmación
let _editGrupo = null;    // id del intercambio en preparación que se edita

const _normNum = s => String(s ?? '').trim().toUpperCase();

function _parsearNumeros(texto) {
  return [...new Set(
    String(texto).split(/[,;\s]+/)
      .map(_normNum)
      .filter(t => /^[A-Z0-9.\-]{1,20}$/.test(t))
  )];
}

// ── Reservas de intercambios pendientes (no finalizados) ──
// Clave: "colId|numero". excluir = grupo que se está editando, para no contarse a sí mismo.
function _reservasPendientes(excluir) {
  const dio = new Map(), recibe = new Map();
  for (const col of STATE.colecciones) for (const t of col.trueques || []) {
    if (t.estado === 'final' || (t.grupo || t.id) === excluir) continue;
    for (const d of t.dio) { const k = col.id + '|' + d.numero; dio.set(k, (dio.get(k) || 0) + 1); }
    for (const r of t.recibio) { const k = col.id + '|' + r.numero; recibe.set(k, (recibe.get(k) || 0) + 1); }
  }
  return { dio, recibe };
}

// ── Aplicar un trueque al inventario (solo al finalizar) ──
function _aplicarTrueque(col, dioNums, recibioNums) {
  const dio = [], recibio = [];
  for (const num of dioNums) {
    const c = col.cromos.find(x => x.numero === num);
    if (!c || !(c.repetidos > 0)) continue;
    c.repetidos--; dio.push({ numero: c.numero, nombre: c.nombre });
  }
  for (const num of recibioNums) {
    const c = col.cromos.find(x => x.numero === num);
    if (!c) continue;
    const falta = c.tengo === false;
    if (falta) c.tengo = true; else c.repetidos = (c.repetidos || 0) + 1;
    recibio.push({ numero: c.numero, nombre: c.nombre, falta });
  }
  return { dio, recibio };
}

// ── Agrupación por intercambio ──
function _intercambios() {
  const grupos = new Map();
  for (const col of STATE.colecciones) for (const t of col.trueques || []) {
    const key = t.grupo || t.id;
    if (!grupos.has(key)) grupos.set(key, { id: key, fecha: t.fecha, estado: t.estado || 'final', partes: [] });
    const g = grupos.get(key);
    g.fecha = Math.max(g.fecha, t.fecha);
    g.partes.push({ col, t });
  }
  return [...grupos.values()].sort((a, b) => b.fecha - a.fecha);
}

function _buscarGrupo(id) {
  return _intercambios().find(g => g.id === id) || null;
}

function _setEstadoGrupo(grupoId, estado) {
  for (const col of STATE.colecciones)
    for (const t of col.trueques || []) if ((t.grupo || t.id) === grupoId) t.estado = estado;
}

// Quita los registros del historial. No toca inventario.
function _quitarGrupo(grupoId) {
  for (const col of STATE.colecciones)
    col.trueques = (col.trueques || []).filter(t => (t.grupo || t.id) !== grupoId);
}

// Quita del historial los finalizados caducados. Los pendientes no caducan.
function _purgarTruequesAntiguos() {
  const limite = Date.now() - PLAZO_HISTORIAL_MS;
  let quitados = 0;
  for (const col of STATE.colecciones) {
    const antes = (col.trueques || []).length;
    col.trueques = (col.trueques || []).filter(t => t.estado !== 'final' || (t.cerrado || t.fecha) >= limite);
    quitados += antes - col.trueques.length;
  }
  return quitados;
}

// ── PASO 1: elegir colecciones ──
function abrirCruce(grupoId) {
  if (!STATE.colecciones.length) { toast('No tienes colecciones', '⚠️'); return; }
  _cruceResult = null; _cruceTxt = null; _cruceSel = []; _editGrupo = null;

  if (grupoId) {
    const g = _buscarGrupo(grupoId);
    if (!g || g.estado !== 'prep') { toast('Solo se pueden editar intercambios en preparación', '⚠️'); return; }
    _editGrupo = g.id;
    _cruceSel = g.partes.map(p => p.col.id);
    _cruceTxt = { recibe: {}, da: {} };
    for (const { col, t } of g.partes) {
      _cruceTxt.recibe[col.id] = t.recibio.map(r => r.numero).join(', ');
      _cruceTxt.da[col.id] = t.dio.map(d => d.numero).join(', ');
    }
    closeModal('modal-trueque-detalle');
    closeModal('modal-trueques');   // evita que el historial quede debajo del cruce
  }
  _renderPaso1();
  openModal('modal-cruce');
}

function _renderPaso1() {
  const marcadas = new Set(_cruceSel.length ? _cruceSel : [STATE.currentColId]);
  document.getElementById('cruce-paso').innerHTML = `
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px">${_editGrupo
      ? 'Editando un intercambio en preparación.'
      : 'Marca las colecciones en las que vais a cambiar cromos.'}</p>
    ${STATE.colecciones.map(c => `<label class="wa-opt-label" style="padding:6px 0">
      <input type="checkbox" class="cruce-col-chk" value="${esc(c.id)}" ${marcadas.has(c.id) ? 'checked' : ''}>
      ${esc(c.emoji)} ${esc(c.name)}</label>`).join('')}
    <div class="modal-actions" style="justify-content:flex-start">
      <button class="btn btn-primary" onclick="cruceIrPaso2()">Continuar</button>
    </div>`;
}

// Guarda lo escrito en el paso 2 antes de cambiar de pantalla
function _guardarTextos() {
  if (!document.querySelector('#cruce-paso input[data-tipo]')) return;
  const leer = tipo => Object.fromEntries(
    [...document.querySelectorAll(`#cruce-paso input[data-tipo="${tipo}"]`)].map(i => [i.dataset.col, i.value])
  );
  _cruceTxt = { recibe: leer('recibe'), da: leer('da') };
}

function cruceAtras() {
  _guardarTextos();
  _renderPaso1();
}

// ── PASO 2: una línea por colección ──
function cruceIrPaso2() {
  if (document.querySelector('.cruce-col-chk')) {
    _cruceSel = [...document.querySelectorAll('.cruce-col-chk:checked')].map(i => i.value);
  }
  if (!_cruceSel.length) { toast('Marca al menos una colección', '⚠️'); return; }
  const cols = _cruceSel.map(id => STATE.colecciones.find(c => c.id === id)).filter(Boolean);
  const valor = (tipo, id) => esc(_cruceTxt?.[tipo]?.[id] || '');
  const linea = (tipo, col) => `<div style="margin-bottom:10px">
    <label style="font-size:12px;font-weight:700;color:var(--text2)">${esc(col.emoji)} ${esc(col.name)}</label>
    <input class="form-input" data-tipo="${tipo}" data-col="${esc(col.id)}" value="${valor(tipo, col.id)}"
      placeholder="Ej: 219, 220, 370A" style="margin-top:4px"></div>`;
  document.getElementById('cruce-paso').innerHTML = `
    <h4 style="font-size:13px;margin:6px 0">📥 Cartas que me dan</h4>
    ${cols.map(c => linea('recibe', c)).join('')}
    <h4 style="font-size:13px;margin:14px 0 6px">📤 Cartas que doy</h4>
    ${cols.map(c => linea('da', c)).join('')}
    <div class="modal-actions" style="justify-content:space-between">
      <button class="btn btn-secondary" onclick="cruceAtras()">← Atrás</button>
      <button class="btn btn-primary" onclick="cruceCalcular()">Revisar</button>
    </div>`;
}

// ── PASO 3: calcular y validar contra reservas ──
function cruceCalcular() {
  _guardarTextos();
  const res = _reservasPendientes(_editGrupo);
  const plan = [];

  for (const colId of _cruceSel) {
    const col = STATE.colecciones.find(c => c.id === colId); if (!col) continue;
    const recNums = _parsearNumeros(_cruceTxt?.recibe?.[colId] || '');
    const daNums  = _parsearNumeros(_cruceTxt?.da?.[colId] || '');
    if (!recNums.length && !daNums.length) continue;   // línea vacía: no se toca

    const porNum = new Map(col.cromos.map(c => [_normNum(c.numero), c]));
    const item = { col, recibe: [], da: [], errores: [], avisos: [] };

    for (const n of recNums) {
      const c = porNum.get(n);
      if (!c) { item.errores.push(`#${n} no existe en la colección`); continue; }
      if (res.recibe.get(col.id + '|' + c.numero)) item.avisos.push(`#${n} ${c.nombre}: ya la tienes pedida en otro intercambio pendiente`);
      if (c.tengo !== false) item.errores.push(`#${n} ${c.nombre}: ya la tienes, no puedes recibirla repetida`);
      item.recibe.push(c);
    }
    for (const n of daNums) {
      const c = porNum.get(n);
      if (!c) { item.errores.push(`#${n} no existe en la colección`); continue; }
      const libres = (c.repetidos || 0) - (res.dio.get(col.id + '|' + c.numero) || 0);
      if (libres <= 0) { item.errores.push(`#${n} ${c.nombre}: no tienes repetido libre (sin repetidos o reservado en otro intercambio)`); continue; }
      item.da.push(c);
    }
    plan.push(item);
  }

  if (!plan.length) { toast('No hay cambios que guardar', '⚠️'); return; }
  _cruceResult = plan;
  renderCruceConfirmacion();
}

function renderCruceConfirmacion() {
  const plan = _cruceResult;
  const bloqueado = plan.some(p => p.errores.length);
  const fila = (c, txt) => `<div style="font-size:13px;padding:3px 0">#${esc(c.numero)} ${esc(c.nombre)}
    <span style="color:var(--text3)">${txt}</span></div>`;

  document.getElementById('cruce-paso').innerHTML = `
    <h4 style="font-size:13px;margin:6px 0">${_editGrupo ? 'Editar intercambio' : 'Guardar intercambio'} (Preparación)</h4>
    <div style="font-weight:700;margin-bottom:10px;color:${bloqueado ? 'var(--red)' : 'var(--green)'}">
      ${bloqueado ? '❌ Este intercambio no se puede realizar' : '✅ Este intercambio se puede realizar'}
    </div>
    ${plan.map(p => `<div class="cards-wrap" style="margin-bottom:10px">
      <b>${esc(p.col.emoji)} ${esc(p.col.name)}</b>
      ${p.recibe.map(c => fila(c, c.tengo === false ? '→ pasará a Tengo al finalizar' : '→ repetido +1 al finalizar')).join('')}
      ${p.da.map(c => fila(c, '→ repetido −1 al finalizar (reservado)')).join('')}
      ${p.errores.map(e => `<div style="font-size:12px;color:var(--red);padding:3px 0">❌ ${esc(e)}</div>`).join('')}
      ${p.avisos.map(a => `<div style="font-size:12px;color:var(--yellow);padding:3px 0">⚠️ ${esc(a)}</div>`).join('')}
    </div>`).join('')}
    <div class="modal-actions" style="justify-content:space-between">
      <button class="btn btn-secondary" onclick="cruceIrPaso2()">← Editar</button>
      <button class="btn btn-green" onclick="cruceConfirmar()" ${bloqueado ? 'disabled' : ''}>💾 Guardar intercambio</button>
    </div>`;
}

// Guarda el intercambio en Preparación. No modifica los contadores.
function cruceConfirmar() {
  if (_cruceResult?.some(p => p.errores.length)) { toast('Corrige los errores antes de guardar', '⚠️'); return; }
  if (!_cruceResult?.length) return;

  const grupo = _editGrupo || uid();
  if (_editGrupo) _quitarGrupo(_editGrupo);   // al editar, se sustituye el intercambio entero
  const lista = arr => arr.map(c => ({ numero: c.numero, nombre: c.nombre }));

  for (const p of _cruceResult) {
    if (!p.da.length && !p.recibe.length) continue;
    p.col.trueques = [{
      id: uid(), grupo, estado: 'prep', fecha: Date.now(),
      dio: lista(p.da), recibio: lista(p.recibe), nota: ''
    }, ...(p.col.trueques || [])].slice(0, 500);
  }

  _cruceResult = null; _cruceSel = []; _cruceTxt = null; _editGrupo = null;
  save();
  closeModal('modal-cruce');
  abrirTrueques();
  toast('Intercambio guardado en preparación 💾', '✅');
}

// ── HISTORIAL ──
function abrirTrueques() {
  if (_purgarTruequesAntiguos()) save();
  const lista = _intercambios();
  const nombres = g => g.partes.map(p => `${esc(p.col.emoji)} ${esc(p.col.name)}`).join(' · ');
  const fmt = ts => new Date(ts).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' });
  document.getElementById('trueques-list').innerHTML = lista.length
    ? lista.map(g => {
        const dio = g.partes.reduce((n, p) => n + p.t.dio.length, 0);
        const recibio = g.partes.reduce((n, p) => n + p.t.recibio.length, 0);
        const color = COLOR_ESTADO[g.estado] || COLOR_ESTADO.final;
        return `<div class="hist-row">
          <span class="hist-badge" style="color:${color};border:1px solid ${color}">${ESTADOS[g.estado] || ESTADOS.final}</span>
          <span class="hist-badge edit">−${dio} / +${recibio}</span>
          <span style="flex:1;font-size:12px">${nombres(g)}</span>
          <span class="hist-date">${fmt(g.fecha)}</span>
          <button class="btn btn-secondary btn-sm" onclick="abrirDetalleTrueque('${esc(g.id)}')">Ver</button>
        </div>`;
      }).join('')
    : '<p style="color:var(--text3);font-size:13px">Sin trueques registrados.</p>';
  openModal('modal-trueques');
}

function _renderAcciones(g) {
  const id = esc(g.id);
  const acciones = {
    prep: `<button class="btn btn-secondary" onclick="abrirCruce('${id}')">✏️ Editar</button>
           <button class="btn btn-danger" onclick="cancelarIntercambio('${id}')">✖ Cancelar</button>
           <button class="btn btn-green" onclick="cambiarEstadoIntercambio('${id}','envio')">📦 Marcar enviado</button>`,
    envio: `<button class="btn btn-secondary" onclick="cambiarEstadoIntercambio('${id}','prep')">↩️ Volver a Preparación</button>
            <button class="btn btn-green" onclick="finalizarIntercambio('${id}')">✅ Marcar finalizado</button>`,
    final: `<button class="btn btn-danger" onclick="eliminarTrueque('${id}')">🗑 Eliminar del historial</button>`
  }[g.estado] || '';
  return acciones + `<button class="btn btn-secondary" onclick="closeModal('modal-trueque-detalle')">Cerrar</button>`;
}

function abrirDetalleTrueque(grupoId) {
  const g = _buscarGrupo(grupoId);
  if (!g) { toast('Este intercambio ya no existe', 'ℹ️'); return; }
  const unicos = arr => [...new Map(arr.map(x => [x.numero, x])).values()];
  const bloque = (titulo, tipo) => {
    const secciones = g.partes.map(({ col, t }) => {
      const cartas = unicos(t[tipo]);
      if (!cartas.length) return '';
      return `<div style="margin:6px 0 10px">
        <div style="font-size:12px;font-weight:700;color:var(--text2)">${esc(col.emoji)} ${esc(col.name)}</div>
        ${cartas.map(c => `<div style="font-size:13px;padding:2px 0"><b>#${esc(c.numero)}</b> ${esc(c.nombre)}</div>`).join('')}
      </div>`;
    }).join('');
    return `<h4 style="font-size:13px;margin:12px 0 4px">${titulo}</h4>${secciones || '<p style="color:var(--text3);font-size:13px">Ninguna</p>'}`;
  };
  const color = COLOR_ESTADO[g.estado] || COLOR_ESTADO.final;
  document.getElementById('trueque-detalle').innerHTML =
    `<span class="hist-badge" style="color:${color};border:1px solid ${color}">${ESTADOS[g.estado] || ESTADOS.final}</span>` +
    bloque('📤 Cartas que doy', 'dio') + bloque('📥 Cartas que me dan', 'recibio');
  document.getElementById('trueque-acciones').innerHTML = _renderAcciones(g);
  openModal('modal-trueque-detalle');
}

// ── TRANSICIONES ──
function cambiarEstadoIntercambio(grupoId, estado) {
  const g = _buscarGrupo(grupoId); if (!g) return;
  if (estado === 'envio' && !confirm('¿Marcar como enviado? Ya no se podrá editar hasta volver a Preparación.')) return;
  _setEstadoGrupo(grupoId, estado);
  save();
  abrirTrueques();
  abrirDetalleTrueque(grupoId);
}

function cancelarIntercambio(grupoId) {
  const g = _buscarGrupo(grupoId); if (!g || g.estado !== 'prep') return;
  if (!confirm('¿Cancelar este intercambio? Sus reservas se liberan.')) return;
  _quitarGrupo(grupoId);
  save();
  closeModal('modal-trueque-detalle');
  abrirTrueques();
  toast('Intercambio cancelado', 'ℹ️');
}

// Aplica el intercambio a las colecciones y lo cierra. Irreversible.
function finalizarIntercambio(grupoId) {
  const g = _buscarGrupo(grupoId); if (!g || g.estado !== 'envio') return;

  const errores = [];
  for (const { col, t } of g.partes) for (const d of t.dio) {
    const c = col.cromos.find(x => x.numero === d.numero);
    if (!c) errores.push(`${col.name}: #${d.numero} ya no existe`);
    else if (!(c.repetidos > 0)) errores.push(`${col.name}: #${d.numero} ya no tiene repetido para dar`);
  }
  if (errores.length) { alert('No se puede finalizar:\n\n' + errores.join('\n')); return; }
  if (!confirm('¿Finalizar el intercambio? Los cambios se aplicarán a las colecciones y ya no se podrá editar.')) return;

  const ahora = Date.now();
  for (const { col, t } of g.partes) {
    const { dio, recibio } = _aplicarTrueque(col, t.dio.map(d => d.numero), t.recibio.map(r => r.numero));
    Object.assign(t, { dio, recibio, estado: 'final', cerrado: ahora });
    addHistorial(col.id, 'edit', `Intercambio finalizado: diste ${dio.length}, recibiste ${recibio.length}`);
  }
  save();
  renderCromos();
  abrirTrueques();
  abrirDetalleTrueque(grupoId);
  toast('Intercambio finalizado ✅', '✅');
}

// Solo quita del historial. No toca cromos.
function eliminarTrueque(grupoId) {
  const g = _buscarGrupo(grupoId); if (!g || g.estado !== 'final') return;
  if (!confirm('¿Eliminar este intercambio del historial? Los cromos no se modifican.')) return;
  _quitarGrupo(grupoId);
  save();
  closeModal('modal-trueque-detalle');
  abrirTrueques();
  toast('Eliminado del historial 🗑️');
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
    ? a.slice(0, 50).filter(x => x && typeof x === 'object').map(x => ({
        numero: strCorto(x.numero, 20),
        nombre: strCorto(x.nombre, 200),
        ...(typeof x.falta === 'boolean' ? { falta: x.falta } : {})
      }))
    : [];
  return Array.isArray(arr)
    ? arr.slice(0, 500).filter(t => t && typeof t === 'object').map(t => ({
        id: strCorto(t.id, 40),
        ...(t.grupo ? { grupo: strCorto(t.grupo, 40) } : {}),
        estado: ['prep', 'envio', 'final'].includes(t.estado) ? t.estado : 'final',  // antiguos = ya aplicados
        fecha: Number(t.fecha) || 0,
        ...(t.cerrado ? { cerrado: Number(t.cerrado) || 0 } : {}),
        dio: lista(t.dio),
        recibio: lista(t.recibio),
        nota: strCorto(t.nota, 200),
        ...(t.editado ? { editado: Number(t.editado) || 0 } : {})
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
