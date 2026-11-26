// Respaldo de ventas (cedible y guía recepcionada) + recortador de fotos antes de subirlas
import { useState, useEffect, useRef } from "react";
import { api, subirArchivo, descargar, fecha, hoyISO } from "./lib";
import { Modal } from "./ui";

export const TIPOS_RESPALDO = [
  ["cedible", "Factura cedible recepcionada"],
  ["guia_recepcion", "Guía de despacho recepcionada"],
  ["recepcion", "Recepción conforme / acta"],
  ["otro_respaldo", "Otro respaldo"],
];
const NOMBRE_DOC = { ...Object.fromEntries(TIPOS_RESPALDO), factura: "Factura (SII)", guia: "Guía (SII)", nota_credito: "Nota de crédito", oc: "OC del cliente", otro: "Otro" };

// Chips de la lista de ventas: completada o lo que falta
export function BadgeRespaldo({ respaldo }) {
  if (!respaldo) return null;
  if (respaldo.completada) return <span className="estado estado-ok" title="Entregada, facturada, pagada y con respaldos">✓ Completada</span>;
  if (!respaldo.faltan?.length) return null;
  return <span className="estado estado-danger" title={`Falta: ${respaldo.faltan.join(", ")}`}>Falta doc. {respaldo.faltan.length > 1 ? `(${respaldo.faltan.length})` : respaldo.faltan[0]}</span>;
}

// Folios que se pueden respaldar en una venta: facturas y guía
export function foliosVenta(v, tipo) {
  if (tipo === "cedible") return (v?.facturas || []).map((f) => String(f.numero));
  if (tipo === "guia_recepcion") return v?.guia_despacho ? [String(v.guia_despacho)] : [];
  return [];
}

// Panel en el detalle de la venta
export function RespaldoVenta({ venta, puede, notify, onCambio }) {
  const r = venta.respaldo;
  const [subir, setSubir] = useState(false);
  if (!r || venta.estado === "anulada") return null;
  const docs = venta.documentos || [];
  return (
    <div className="respaldo-venta">
      <div className="respaldo-titulo">
        <b>Estado y respaldo de la venta</b>
        {r.completada ? <span className="estado estado-ok">✓ Venta completada</span> : r.faltan?.length ? <span className="estado estado-danger">FALTA DOC: {r.faltan.join(", ")}</span> : null}
        {puede && <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setSubir(true)}>+ Subir cedible / guía firmada</button>}
      </div>
      <div className="respaldo-checks">
        {r.checks.map((c) => <span key={c.clave} className={`respaldo-check ${c.ok ? "ok" : /^FALTA/.test(c.texto) ? "falta" : ""}`}>{c.ok ? "✓" : /^FALTA/.test(c.texto) ? "✗" : "○"} {c.texto}</span>)}
      </div>
      {docs.length > 0 && (
        <div className="respaldo-docs">
          {docs.map((d) => (
            <button key={d.id} className="btn btn-ghost btn-sm" title={`${d.nombre_archivo} · ${d.creado_por || ""} · ${fecha(d.createdAt)}`}
              onClick={() => descargar(`/ventas/${venta.id}/documentos/${d.id}`, d.nombre_archivo).catch((e) => notify(e.message, "danger"))}>
              📎 {NOMBRE_DOC[d.tipo] || d.tipo}{d.folio ? ` N° ${d.folio}` : ""}
            </button>
          ))}
        </div>
      )}
      {subir && <SubirRespaldo venta={venta} notify={notify} onClose={() => setSubir(false)} onHecho={() => { setSubir(false); onCambio?.(); }} />}
    </div>
  );
}

// Elige tipo y folio; sugiere el primero que falta
function CamposRespaldo({ venta, form, setForm }) {
  const folios = foliosVenta(venta, form.tipo);
  return (
    <>
      <div className="field">
        <label>¿Qué documento es?</label>
        <div className="empresa-btns" style={{ flexWrap: "wrap" }}>
          {TIPOS_RESPALDO.map(([v, t]) => <button key={v} type="button" className={`empresa-btn ${form.tipo === v ? "activo" : ""}`}
            onClick={() => setForm({ ...form, tipo: v, folio: foliosFaltantes(venta, v)[0] || foliosVenta(venta, v)[0] || "" })}>{t}</button>)}
        </div>
      </div>
      <div className="fields-row">
        <div className="field">
          <label>{form.tipo === "guia_recepcion" ? "N° de guía" : form.tipo === "cedible" ? "N° de factura" : "N° (opcional)"}</label>
          {folios.length > 0
            ? <select value={form.folio} onChange={(e) => setForm({ ...form, folio: e.target.value })}>
                {folios.map((f) => <option key={f} value={f}>{f}{foliosFaltantes(venta, form.tipo).includes(f) ? " (falta)" : " (ya tiene)"}</option>)}
                <option value="">Otro / sin número</option>
              </select>
            : <input value={form.folio} onChange={(e) => setForm({ ...form, folio: e.target.value })} placeholder="N°" />}
        </div>
        <div className="field">
          <label>Fecha de recepción</label>
          <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
        </div>
      </div>
    </>
  );
}

function foliosFaltantes(venta, tipo) {
  const falt = venta?.respaldo?.faltan || [];
  const pref = tipo === "cedible" ? "cedible " : tipo === "guia_recepcion" ? "guía " : null;
  return pref ? falt.filter((f) => f.startsWith(pref)).map((f) => f.slice(pref.length)) : [];
}

export function formInicial(venta) {
  const tipo = foliosFaltantes(venta, "cedible").length || !foliosFaltantes(venta, "guia_recepcion").length ? "cedible" : "guia_recepcion";
  return { tipo, folio: foliosFaltantes(venta, tipo)[0] || foliosVenta(venta, tipo)[0] || "", fecha: hoyISO() };
}

function SubirRespaldo({ venta, notify, onClose, onHecho }) {
  const [form, setForm] = useState(() => formInicial(venta));
  const [archivo, setArchivo] = useState(null);
  const [recortar, setRecortar] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    if (!archivo) return notify("Adjunta la foto o el PDF", "danger");
    setEnviando(true);
    try { await subirArchivo(`/ventas/${venta.id}/respaldo`, archivo, form); notify("Respaldo guardado en la venta", "success"); onHecho(); }
    catch (e) { notify(e.message, "danger"); } finally { setEnviando(false); }
  };
  const elegir = async (f) => { if (!f) return; setArchivo(esImagen(f) ? await comprimirImagen(f) : f); };
  return (
    <Modal titulo={`Respaldo · ${venta.numero} · ${venta.cliente_nombre || ""}`} onClose={onClose} ancho={520}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-success" disabled={enviando || !archivo} onClick={enviar}>{enviando ? "Guardando..." : "Guardar en la venta"}</button></>}>
      <CamposRespaldo venta={venta} form={form} setForm={setForm} />
      <div className="field">
        <label>Documento firmado (foto o PDF)</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label className="btn btn-ghost btn-sm">📷 Sacar foto<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <label className="btn btn-ghost btn-sm">📁 Elegir archivo<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ""; }} /></label>
        </div>
        {archivo && <div className="mini" style={{ marginTop: 6 }}>{archivo.name} · {Math.round(archivo.size / 1024)} KB
          {esImagen(archivo) && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setRecortar(archivo)}>✂ Encuadrar</button>}</div>}
      </div>
      {recortar && <Recortador archivo={recortar} onClose={() => setRecortar(null)} onListo={(f) => { setArchivo(f); setRecortar(null); }} />}
    </Modal>
  );
}

// Desde la bandeja: guarda el documento como respaldo de una venta
export function RegistrarEnVenta({ doc, ventas, notify, onClose, onHecho }) {
  const [ventaId, setVentaId] = useState(doc.venta_id || "");
  const [venta, setVenta] = useState(null);
  const [form, setForm] = useState({ tipo: "cedible", folio: "", fecha: hoyISO() });
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (!ventaId) { setVenta(null); return; }
    let vivo = true;
    api(`/ventas/${ventaId}`).then((v) => { if (vivo) { setVenta(v); setForm(formInicial(v)); } }).catch((e) => notify(e.message, "danger"));
    return () => { vivo = false; };
  }, [ventaId, notify]);
  const enviar = async () => {
    setEnviando(true);
    try { const r = await api(`/bandeja/${doc.id}/a-venta`, { method: "POST", body: { venta_id: ventaId, ...form } }); notify(`Guardado como respaldo de ${r.venta_numero}`, "success"); onHecho(); }
    catch (e) { notify(e.message, "danger"); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo="Registrar como respaldo de una venta" onClose={onClose} ancho={520}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-success" disabled={enviando || !venta} onClick={enviar}>{enviando ? "Guardando..." : "Guardar en la venta"}</button></>}>
      <div className="field">
        <label>Venta</label>
        <select value={ventaId} onChange={(e) => setVentaId(e.target.value)}>
          <option value="">— Elige la venta —</option>
          {ventas.map((v) => <option key={v.id} value={v.id}>{v.numero} · {v.cliente_nombre || "sin cliente"}{v.respaldo?.faltan?.length ? ` · falta ${v.respaldo.faltan.join(", ")}` : ""}</option>)}
        </select>
      </div>
      {venta && <>
        {venta.respaldo?.faltan?.length > 0 && <div className="aviso-clave">Esta venta tiene pendiente: <b>{venta.respaldo.faltan.join(", ")}</b></div>}
        <CamposRespaldo venta={venta} form={form} setForm={setForm} />
      </>}
    </Modal>
  );
}

// ---------- Fotos: comprimir y encuadrar ----------
export const esImagen = (f) => /^image\/(jpe?g|png|webp|heic|heif)/i.test(f?.type || "") || /\.(jpe?g|png|webp)$/i.test(f?.name || "");

function cargarImagen(file) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => ok({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("No se pudo abrir la imagen")); };
    img.src = url;
  });
}

function aJPEG(canvas, nombre) {
  return new Promise((ok) => canvas.toBlob((b) => ok(new File([b], nombre.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })), "image/jpeg", 0.85));
}

// Dibuja (rotada y recortada) con lado mayor de hasta 2000 px
async function dibujar(img, rot, rect, nombre) {
  const lw = rot % 2 ? img.naturalHeight : img.naturalWidth, lh = rot % 2 ? img.naturalWidth : img.naturalHeight;
  const r = rect || { x: 0, y: 0, w: 1, h: 1 };
  const sw = r.w * lw, sh = r.h * lh;
  const k = Math.min(1, 2000 / Math.max(sw, sh));
  const rotada = document.createElement("canvas");
  rotada.width = lw; rotada.height = lh;
  const g = rotada.getContext("2d");
  g.translate(lw / 2, lh / 2); g.rotate((rot * Math.PI) / 2);
  g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const out = document.createElement("canvas");
  out.width = Math.round(sw * k); out.height = Math.round(sh * k);
  out.getContext("2d").drawImage(rotada, r.x * lw, r.y * lh, sw, sh, 0, 0, out.width, out.height);
  return aJPEG(out, nombre);
}

// Achica fotos pesadas del celular (pasa de ~4 MB a ~400 KB); si ya es liviana la deja igual
export async function comprimirImagen(file) {
  if (!esImagen(file) || file.size < 600 * 1024) return file;
  try {
    const { img, url } = await cargarImagen(file);
    const f = await dibujar(img, 0, null, file.name);
    URL.revokeObjectURL(url);
    return f.size < file.size ? f : file;
  } catch { return file; }
}

// Busca el papel: recorta el borde que es parecido al color de las orillas (mesa, fondo)
function autoRecorte(canvas) {
  const W = canvas.width, H = canvas.height, d = canvas.getContext("2d").getImageData(0, 0, W, H).data;
  const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const borde = [];
  for (let x = 0; x < W; x += 4) borde.push(px(x, 0), px(x, H - 1));
  for (let y = 0; y < H; y += 4) borde.push(px(0, y), px(W - 1, y));
  const med = [0, 1, 2].map((c) => borde.map((p) => p[c]).sort((a, b) => a - b)[borde.length >> 1]);
  const distinto = (p) => Math.abs(p[0] - med[0]) + Math.abs(p[1] - med[1]) + Math.abs(p[2] - med[2]) > 60;
  const filaOk = (y) => { let n = 0; for (let x = 0; x < W; x += 2) if (distinto(px(x, y))) n++; return n > W / 2 * 0.25; };
  const colOk = (x) => { let n = 0; for (let y = 0; y < H; y += 2) if (distinto(px(x, y))) n++; return n > H / 2 * 0.25; };
  let t = 0, b = H - 1, l = 0, r = W - 1;
  while (t < b && !filaOk(t)) t++;
  while (b > t && !filaOk(b)) b--;
  while (l < r && !colOk(l)) l++;
  while (r > l && !colOk(r)) r--;
  if ((r - l) < W * 0.2 || (b - t) < H * 0.2) return null;
  return { x: l / W, y: t / H, w: (r - l + 1) / W, h: (b - t + 1) / H };
}

export function Recortador({ archivo, onClose, onListo }) {
  const [img, setImg] = useState(null);
  const [rot, setRot] = useState(0);
  const [rect, setRect] = useState({ x: 0.03, y: 0.03, w: 0.94, h: 0.94 });
  const [listo, setListo] = useState(false);
  const caja = useRef(null);
  const arrastre = useRef(null);
  const vista = useRef(null);

  const cerrar = useRef(onClose); cerrar.current = onClose;
  useEffect(() => {
    let url;
    cargarImagen(archivo).then((r) => { url = r.url; setImg(r.img); }).catch(() => cerrar.current());
    return () => url && URL.revokeObjectURL(url);
  }, [archivo]);

  // Vista previa rotada (chica, para mover el marco y para el auto-ajuste)
  useEffect(() => {
    if (!img || !vista.current) return;
    const c = vista.current, lw = rot % 2 ? img.naturalHeight : img.naturalWidth, lh = rot % 2 ? img.naturalWidth : img.naturalHeight;
    const k = Math.min(1, 900 / Math.max(lw, lh));
    c.width = Math.round(lw * k); c.height = Math.round(lh * k);
    const g = c.getContext("2d");
    g.save(); g.translate(c.width / 2, c.height / 2); g.rotate((rot * Math.PI) / 2);
    g.drawImage(img, (-img.naturalWidth * k) / 2, (-img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    g.restore();
  }, [img, rot]);

  const automatico = () => { const r = vista.current && autoRecorte(vista.current); if (r) setRect(r); };
  useEffect(() => { if (img) setTimeout(automatico, 30); }, [img, rot]); // eslint-disable-line react-hooks/exhaustive-deps

  const mover = (e) => {
    const a = arrastre.current; if (!a) return;
    const b = caja.current.getBoundingClientRect();
    const dx = (e.clientX - a.x0) / b.width, dy = (e.clientY - a.y0) / b.height, r0 = a.r;
    const lim = (v) => Math.max(0, Math.min(1, v)), MIN = 0.08;
    let { x, y, w, h } = r0;
    if (a.modo === "mover") { x = lim(Math.min(r0.x + dx, 1 - r0.w)); y = lim(Math.min(r0.y + dy, 1 - r0.h)); }
    else {
      if (a.modo.includes("l")) { x = lim(Math.min(r0.x + dx, r0.x + r0.w - MIN)); w = r0.x + r0.w - x; }
      if (a.modo.includes("r")) { w = Math.max(MIN, Math.min(1 - r0.x, r0.w + dx)); }
      if (a.modo.includes("t")) { y = lim(Math.min(r0.y + dy, r0.y + r0.h - MIN)); h = r0.y + r0.h - y; }
      if (a.modo.includes("b")) { h = Math.max(MIN, Math.min(1 - r0.y, r0.h + dy)); }
    }
    setRect({ x, y, w, h });
  };
  const empezar = (modo) => (e) => { e.stopPropagation(); e.preventDefault(); arrastre.current = { modo, x0: e.clientX, y0: e.clientY, r: rect }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const soltar = () => { arrastre.current = null; };

  const aplicar = async () => { setListo(true); try { onListo(await dibujar(img, rot, rect, archivo.name)); } finally { setListo(false); } };
  const pct = (v) => `${v * 100}%`;
  return (
    <Modal titulo="Encuadrar la foto" onClose={onClose} ancho={640}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-success" disabled={!img || listo} onClick={aplicar}>{listo ? "Preparando..." : "Usar este recorte"}</button></>}>
      <div className="mini" style={{ marginBottom: 6 }}>Arrastra las esquinas para dejar solo el documento. El marco se ajusta solo al papel; si no queda bien, muévelo a mano.</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setRot((rot + 3) % 4)}>⟲ Girar</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setRot((rot + 1) % 4)}>⟳ Girar</button>
        <button className="btn btn-ghost btn-sm" onClick={automatico}>✨ Ajuste automático</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}>Foto completa</button>
      </div>
      <div className="recorte-zona">
        <div className="recorte-caja" ref={caja} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
          <canvas ref={vista} className="recorte-canvas" />
          {img && <>
            <div className="recorte-sombra" style={{ left: 0, top: 0, right: 0, height: pct(rect.y) }} />
            <div className="recorte-sombra" style={{ left: 0, bottom: 0, right: 0, height: pct(1 - rect.y - rect.h) }} />
            <div className="recorte-sombra" style={{ left: 0, top: pct(rect.y), width: pct(rect.x), height: pct(rect.h) }} />
            <div className="recorte-sombra" style={{ right: 0, top: pct(rect.y), width: pct(1 - rect.x - rect.w), height: pct(rect.h) }} />
            <div className="recorte-marco" style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }} onPointerDown={empezar("mover")}>
              {["tl", "tr", "bl", "br", "t", "b", "l", "r"].map((m) => <span key={m} className={`recorte-asa asa-${m}`} onPointerDown={empezar(m)} />)}
            </div>
          </>}
        </div>
      </div>
    </Modal>
  );
}
