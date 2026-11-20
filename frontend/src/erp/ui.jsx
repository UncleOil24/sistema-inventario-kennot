// Piezas compartidas por las vistas del ERP
import { useState, useMemo, useEffect } from "react";
import { fmt, fecha, hoyISO, sinTildes, descargarPost, api, imprimirHTML, escaparHTML } from "./lib";

export function Modal({ titulo, onClose, children, footer, ancho = 480 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: ancho }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{titulo}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

const ESTADOS = {
  borrador: ["Borrador", "neutral"],
  recibida: ["Recibida", "ok"],
  emitida: ["Emitida", "ok"],
  anulada: ["Anulada", "muted"],
  pendiente: ["Pendiente", "warn"],
  parcial: ["Pago parcial", "info"],
  pagada: ["Pagada", "ok"],
  vendida: ["Vendida", "ok"],
  cotizacion: ["Cotización", "info"],
  aceptada: ["Aceptada · venta", "ok"],
  rechazada: ["Rechazada", "muted"],
  vencida: ["Vencida", "warn"],
  convenio: ["Convenio", "info"],
  particular: ["Particular", "neutral"],
  web: ["Tienda web", "neutral"],
  proveedor: ["Proveedor", "info"],
  exacto: ["Exacto", "ok"],
  equivalente: ["Equivalente", "info"],
  parecido: ["Parecido", "warn"],
  sin_producto: ["Sin producto", "warn"],
  nuevo: ["Nuevo en catálogo", "info"],
  activo: ["Activo", "ok"],
  inactivo: ["Inactivo", "muted"],
  abierto: ["En curso", "info"],
  kenott: ["Kenott", "ok"],
  tactics: ["Tactics", "info"],
  cerrado: ["Terminado", "neutral"],
};
export function Estado({ valor }) {
  const [txt, tono] = ESTADOS[valor] || [valor, "neutral"];
  return <span className={`estado estado-${tono}`}>{txt}</span>;
}

// Editor de líneas: buscar producto, agregar, editar cantidad y precio.
// precioDe(producto) -> precio sugerido para la línea (venta según tipo de cliente, o compra)
export function ItemsEditor({ items, setItems, productos, precioDe, etiquetaPrecio = "Precio neto" }) {
  const [q, setQ] = useState("");
  const sugerencias = useMemo(() => {
    const palabras = sinTildes(q).trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return productos
      .filter((p) => { const t = sinTildes(`${p.codigo ?? ""} ${p.nombre}`); return palabras.every((w) => t.includes(w)); })
      .filter((p) => !items.some((i) => i.producto_id === p.id))
      .slice(0, 10);
  }, [q, productos, items]);

  const agregar = (p) => {
    setItems([...items, { producto_id: p.id, nombre: p.nombre, unidad: p.unidad, cantidad: 1, precio: Number(precioDe(p)) || 0 }]);
    setQ("");
  };
  const set = (id, campo, val) => setItems(items.map((i) => (i.producto_id === id ? { ...i, [campo]: val } : i)));
  const subtotal = items.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0);

  return (
    <div className="items-editor">
      <div className="field" style={{ position: "relative" }}>
        <label>Agregar producto</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Palabras en cualquier orden o N°..." />
        {sugerencias.length > 0 && (
          <div className="sugerencias">
            {sugerencias.map((p) => (
              <button key={p.id} className="sugerencia" onClick={() => agregar(p)}>
                <span>{p.nombre}</span>
                <span className="sug-meta">{p.unidad} · {fmt(precioDe(p))}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr><th>Producto</th><th>Cant.</th><th>{etiquetaPrecio}</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.producto_id} className={!(Number(i.precio) > 0) ? "fila-alerta" : ""}>
                  <td>{i.nombre}<div className="mini">{i.unidad}{!(Number(i.precio) > 0) ? " — sin precio" : ""}</div></td>
                  <td><input className="qty-input" type="number" min="0" step="any" value={i.cantidad} onChange={(e) => set(i.producto_id, "cantidad", e.target.value)} /></td>
                  <td><input className="qty-input" style={{ width: 90 }} type="number" min="0" value={i.precio} onChange={(e) => set(i.producto_id, "precio", e.target.value)} /></td>
                  <td className="price-cell">{fmt(Number(i.precio) * Number(i.cantidad))}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => setItems(items.filter((x) => x.producto_id !== i.producto_id))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Totales subtotal={subtotal} />
    </div>
  );
}

export function Totales({ subtotal, iva, total }) {
  const s = Number(subtotal) || 0;
  const i = iva ?? Math.round(s * 0.19);
  const t = total ?? s + i;
  return (
    <div className="cot-totals" style={{ marginBottom: 0 }}>
      <div className="total-row"><span className="total-label">Neto</span><span className="total-value">{fmt(s)}</span></div>
      <div className="total-row"><span className="total-label">IVA (19%)</span><span className="total-value">{fmt(i)}</span></div>
      <hr className="divider" />
      <div className="total-row grand"><span className="total-label">Total</span><span className="total-value">{fmt(t)}</span></div>
    </div>
  );
}

// Lista de pagos/cobros + formulario para registrar uno nuevo
export function PagosPanel({ doc, tipo, onRegistrar, onEliminar }) {
  const saldo = Number(doc.total) - Number(doc.monto_pagado);
  const [form, setForm] = useState({ monto: Math.round(saldo), fecha: hoyISO(), medio: "transferencia", nota: "", factoring_entidad: "", factoring_comision: "" });
  const [enviando, setEnviando] = useState(false);
  const verbo = tipo === "cobro" ? "cobro" : "pago";

  const registrar = async () => {
    setEnviando(true);
    try { await onRegistrar({ ...form, monto: Number(form.monto), factoring_comision: Number(form.factoring_comision) || 0 }); }
    finally { setEnviando(false); }
  };

  return (
    <div className="panel">
      <div className="panel-titulo">
        {tipo === "cobro" ? "Cobros" : "Pagos"} · saldo <strong style={{ color: saldo > 0 ? "var(--accent)" : "var(--success)" }}>{fmt(saldo)}</strong>
      </div>
      {(doc.pagos || []).length === 0 ? (
        <div className="mini">Sin {verbo}s registrados</div>
      ) : (
        <table className="table table-compacta">
          <tbody>
            {doc.pagos.map((p) => (
              <tr key={p.id}>
                <td className="mini">{fecha(p.fecha)}</td>
                <td className="mini">{p.medio}{p.factoring_entidad ? ` ${p.factoring_entidad}` : ""}{Number(p.factoring_comision) > 0 ? ` · comisión ${fmt(p.factoring_comision)}` : ""}{p.nota ? ` · ${p.nota}` : ""}</td>
                <td className="price-cell">{fmt(p.monto)}</td>
                <td className="mini">{p.creado_por || ""}</td>
                <td>{onEliminar && <button className="btn btn-danger btn-sm" title={`Eliminar ${verbo}`} onClick={() => onEliminar(p)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {doc.estado !== "anulada" && saldo > 0.5 && (
        <div className="pago-form">
          <input type="number" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} title="Monto" />
          <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
          <select value={form.medio} onChange={(e) => setForm({ ...form, medio: e.target.value })}>
            {["transferencia", "efectivo", "cheque", "tarjeta", "vale vista", ...(tipo === "cobro" ? ["factoring"] : []), "otro"].map((m) => <option key={m}>{m}</option>)}
          </select>
          {form.medio === "factoring" && <>
            <input placeholder="Entidad de factoring" value={form.factoring_entidad} onChange={(e) => setForm({ ...form, factoring_entidad: e.target.value })} />
            <input type="number" placeholder="Comisión ($)" value={form.factoring_comision} onChange={(e) => setForm({ ...form, factoring_comision: e.target.value })} title="Queda como gasto financiero de la venta" />
          </>}
          <button className="btn btn-success btn-sm" disabled={enviando || !(Number(form.monto) > 0)} onClick={registrar}>
            + Registrar {verbo}
          </button>
        </div>
      )}
    </div>
  );
}

export function Cargando() {
  return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;
}

// Selector de producto para revisar un calce: candidatos propuestos + búsqueda en todo el catálogo
export function SelectorProducto({ valor, candidatos = [], productos, onChange, precioDe, permitirNinguno = true }) {
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState("");
  const sugerencias = useMemo(() => {
    const palabras = sinTildes(q).trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return productos.filter((p) => { const t = sinTildes(`${p.codigo ?? ""} ${p.nombre}`); return palabras.every((w) => t.includes(w)); }).slice(0, 10);
  }, [q, productos]);
  const opciones = [...candidatos];
  if (valor && !opciones.some((c) => c.id === valor.id)) opciones.unshift(valor);

  if (buscando) {
    return (
      <div style={{ position: "relative", minWidth: 260 }}>
        <input autoFocus className="qty-input" style={{ width: "100%", textAlign: "left" }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en el catálogo..." onBlur={() => setTimeout(() => setBuscando(false), 200)} />
        {sugerencias.length > 0 && (
          <div className="sugerencias">
            {sugerencias.map((p) => (
              <button key={p.id} className="sugerencia" onMouseDown={() => { onChange(p); setBuscando(false); setQ(""); }}>
                <span><span className="mini">{p.codigo}</span> {p.nombre}</span>
                {precioDe && <span className="sug-meta">{fmt(precioDe(p))}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 260 }}>
      <select className="select-linea" value={valor?.id || ""} onChange={(e) => {
        if (e.target.value === "__buscar") { setBuscando(true); return; }
        onChange(opciones.find((c) => String(c.id) === e.target.value) || null);
      }}>
        {permitirNinguno && <option value="">— Ninguno —</option>}
        {opciones.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ""}{c.nombre}</option>)}
        <option value="__buscar">🔍 Buscar otro...</option>
      </select>
    </div>
  );
}

// Recorrido de una venta (una OC = una venta)
export const ETAPAS_VENTA = [
  ["registrada", "Registrada", "Comercial la ingresó; falta que Operativo la acepte"],
  ["aceptada", "En compra", "Operativo la aceptó y está comprando"],
  ["lista", "Productos listos", "Llegó todo: lista para facturar y despachar"],
  ["despachada", "Despachada", "Salió hacia el cliente"],
  ["entregada", "Entregada", "El cliente la recibió"],
];
const TONO_ETAPA = { registrada: "warn", aceptada: "info", lista: "ok", despachada: "info", entregada: "neutral" };
const FACTURA = { sin_factura: ["Sin factura", "muted"], parcial: ["Factura parcial", "warn"], facturada: ["Facturada", "ok"] };
export function Etapa({ valor }) {
  const e = ETAPAS_VENTA.find(([k]) => k === valor);
  return <span className={`estado estado-${TONO_ETAPA[valor] || "neutral"}`} title={e?.[2]}>{e?.[1] || valor}</span>;
}
export function EstadoFactura({ valor }) {
  const [txt, tono] = FACTURA[valor] || [valor, "neutral"];
  return <span className={`estado estado-${tono}`}>{txt}</span>;
}
// Línea de pasos: registrada → en compra → listos → despachada → entregada
export function Recorrido({ etapa }) {
  const i = ETAPAS_VENTA.findIndex(([k]) => k === etapa);
  return (
    <div className="recorrido">
      {ETAPAS_VENTA.map(([k, t], n) => (
        <div key={k} className={`paso ${n < i ? "hecho" : n === i ? "actual" : ""}`} title={ETAPAS_VENTA[n][2]}>
          <span className="paso-num">{n < i ? "✓" : n + 1}</span>{t}
        </div>
      ))}
    </div>
  );
}

// Categoría del catálogo: lista desplegable con las existentes y opción de crear una nueva.
// (Antes era un campo con sugerencias que solo mostraba las que calzaban con lo escrito.)
export function SelectorCategoria({ value, onChange, categorias }) {
  const lista = (categorias || []).map((c) => c.categoria).filter(Boolean);
  const [nueva, setNueva] = useState(false);
  const enLista = lista.includes(value);
  if (nueva || (value && !enLista && lista.length)) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input autoFocus style={{ flex: 1, minWidth: 0 }} value={value || ""} placeholder="Nueva categoría" onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNueva(false); onChange(""); }} title="Volver a la lista">Lista</button>
      </div>
    );
  }
  return (
    <select value={enLista ? value : ""} onChange={(e) => (e.target.value === "__nueva" ? (setNueva(true), onChange("")) : onChange(e.target.value))}>
      <option value="">— Elegir categoría —</option>
      {lista.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="__nueva">+ Nueva categoría…</option>
    </select>
  );
}

// --- Avisos del sistema (reemplazan confirm() y prompt() del navegador) -----------------------------
// Uso: if (!(await confirmar("¿Eliminar X?", { peligro: true, boton: "Eliminar" }))) return;
//      const motivo = await pedirTexto("¿Por qué se rechazó?", { placeholder: "precio, plazo..." }); // null = canceló
// Una sola ventana para todo el sistema; <Avisos /> se monta una vez en App.
let abrirAviso = null;
const mostrarAviso = (op) => new Promise((resolve) => {
  if (!abrirAviso) { resolve(op.texto ? window.prompt(op.mensaje, op.valor || "") : window.confirm(op.mensaje)); return; }
  abrirAviso({ ...op, resolve });
});
export const confirmar = (mensaje, opciones = {}) => mostrarAviso({ mensaje, ...opciones });
export const pedirTexto = (mensaje, opciones = {}) => mostrarAviso({ mensaje, texto: true, ...opciones });
// Elegir entre varias opciones: [{ valor, texto }] -> el valor elegido o null
export const elegir = (mensaje, eleccion, opciones = {}) => mostrarAviso({ mensaje, eleccion, ...opciones });

export function Avisos() {
  const [op, setOp] = useState(null);
  const [valor, setValor] = useState("");
  useEffect(() => { abrirAviso = (o) => { setValor(o.valor || ""); setOp(o); }; return () => { abrirAviso = null; }; }, []);
  if (!op) return null;
  const cerrar = (resultado) => { op.resolve(resultado); setOp(null); };
  if (op.eleccion) {
    return (
      <Modal titulo={`// ${op.titulo || "Elegir"}`} onClose={() => cerrar(null)} ancho={520}
        footer={<>
          <button className="btn btn-ghost" onClick={() => cerrar(null)}>Cancelar</button>
          {op.eleccion.map((o, k) => <button key={o.valor} className={`btn ${k === op.eleccion.length - 1 ? "btn-primary" : "btn-ghost"}`} onClick={() => cerrar(o.valor)}>{o.texto}</button>)}
        </>}>
        <div style={{ whiteSpace: "pre-line", fontSize: 14, lineHeight: 1.5 }}>{op.mensaje}</div>
      </Modal>
    );
  }
  const aceptar = () => {
    if (op.texto && op.obligatorio && !valor.trim()) return;
    cerrar(op.texto ? valor.trim() : true);
  };
  return (
    <Modal titulo={`// ${op.titulo || (op.texto ? "Indica el detalle" : "Confirmar")}`} onClose={() => cerrar(op.texto ? null : false)} ancho={520}
      footer={<>
        <button className="btn btn-ghost" onClick={() => cerrar(op.texto ? null : false)}>Cancelar</button>
        <button className={`btn ${op.peligro ? "btn-danger" : "btn-primary"}`} autoFocus={!op.texto} disabled={op.texto && op.obligatorio && !valor.trim()} onClick={aceptar}>{op.boton || "Aceptar"}</button>
      </>}>
      <div style={{ whiteSpace: "pre-line", fontSize: 14, lineHeight: 1.5 }}>{op.mensaje}</div>
      {op.texto && op.sugerencias && (
        <div className="chips" style={{ marginTop: 12 }}>
          {op.sugerencias.map((s) => <button key={s} type="button" className={`chip ${valor === s ? "activo" : ""}`} onClick={() => setValor(s)}>{s}</button>)}
          <button type="button" className={`chip ${valor && !op.sugerencias.includes(valor) ? "activo" : ""}`} onClick={() => { setValor(""); setTimeout(() => document.getElementById("aviso-texto")?.focus(), 0); }}>Otro…</button>
        </div>
      )}
      {op.texto && (
        <div className="field" style={{ marginTop: 12 }}>
          <input id="aviso-texto" autoFocus={!op.sugerencias} value={valor} placeholder={op.placeholder || ""} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aceptar()} />
        </div>
      )}
    </Modal>
  );
}

// Motivo de rechazo de una cotización: opciones rápidas u "Otro" con texto
export const MOTIVOS_RECHAZO = ["Fuera de plazo", "Adj. a otro proveedor", "Eliminada"];
export const motivoRechazo = (nombre) => pedirTexto(`¿Por qué se rechazó la ${nombre}?`, {
  titulo: "Cotización rechazada", sugerencias: MOTIVOS_RECHAZO, placeholder: "Elige una opción o escribe otro motivo", boton: "Marcar rechazada", obligatorio: true,
});

// Pedido a proveedor: qué líneas incluir (si todas tienen precio, o ninguna, no se pregunta)
export const modoPedido = async (items) => {
  const tot = (items || []).length;
  const sin = (items || []).filter((i) => !(Number(i.costo) > 0)).length;
  if (!sin || sin === tot) return "todas";
  return elegir("¿Qué líneas van en el pedido?\nEl Excel sale sin nuestros valores, con una hoja General y una hoja por especialidad (pinturas, eléctrico, gasfitería...).",
    [{ valor: "todas", texto: `Todas las líneas (${tot})` }, { valor: "sin_precio", texto: `Solo sin precio (${sin})` }], { titulo: "Pedido a proveedor" });
};

// Reparto de una línea de factura entre ventas (la misma factura puede cubrir productos de varias ventas).
// l.ventas_pendientes: [{ venta_id, numero, cliente, falta }]; l.reparto: [{ venta_id | null, cantidad }]
export function RepartoLinea({ l, onChange }) {
  if (!l.producto || l.producto.id !== l.reparto_de) return null;
  const cands = [...(l.ventas_pendientes || [])];
  for (const r of l.reparto || []) if (r.venta_id && !cands.some((c) => c.venta_id === r.venta_id)) cands.push({ venta_id: r.venta_id, numero: `venta ${r.venta_id}`, falta: 0 });
  if (!cands.length) return <div className="mini" style={{ color: "var(--warn)" }}>Ninguna venta en curso lo necesita: queda como compra sin venta</div>;
  const cant = Number(l.cantidad) || 0;
  const de = (vid) => Number((l.reparto || []).find((r) => r.venta_id === vid)?.cantidad || 0);
  const suma = cands.reduce((s, c) => s + de(c.venta_id), 0);
  const sin = cant - suma;
  const cambiar = (vid, v) => {
    const otros = (l.reparto || []).filter((r) => r.venta_id !== vid && r.venta_id);
    onChange([...otros, { venta_id: vid, cantidad: Math.max(0, Number(v) || 0) }].filter((r) => r.cantidad > 0));
  };
  const sencillo = cands.length === 1 && de(cands[0].venta_id) === cant;
  return (
    <div className="mini reparto-linea">
      {sencillo ? <>→ {cands[0].numero}{cands[0].cliente ? ` · ${cands[0].cliente}` : ""}</> : <>
        <span>Para:</span>
        {cands.map((c) => (
          <label key={c.venta_id} title={c.cliente || ""}>{c.numero}{c.cliente ? ` ${String(c.cliente).replace(/^(I\.?\s*)?MUNICIPALIDAD DE /i, "Muni ").slice(0, 18)}` : ""}{c.falta ? ` (falta ${c.falta})` : ""}
            <input type="number" min="0" className="qty-input" style={{ width: 56 }} value={de(c.venta_id)} onChange={(e) => cambiar(c.venta_id, e.target.value)} /></label>
        ))}
        {sin > 0 && <span>· sin venta: {sin}</span>}
        {sin < 0 && <span style={{ color: "var(--danger)" }}>· reparte {suma} y la línea trae {cant}</span>}
      </>}
    </div>
  );
}
// Reparto que se manda al registrar (lo que no se asignó queda sin venta)
// --- Presentación de compra (bidón 5 L = 5 litros, rollo 50 m = 50 metros, caja 100 = 100 unidades) ---------------
const UNIDAD_BASE = (u) => { const t = String(u || "").toUpperCase(); return /^L(T|ITRO)/.test(t) ? "LITRO" : /^M(T|ETRO)/.test(t) && !/^M2|^M3/.test(t) ? "METRO" : /^K(G|ILO)/.test(t) ? "KILO" : /^UN/.test(t) ? "UNIDAD" : t; };
const factorDe = (l) => (Number(l.factor) > 0 ? Number(l.factor) : 1);
// Al elegir "Es para:" una línea del pedido o de la venta: ese producto, y el factor que dice la descripción si calza la unidad
export function elegirPara(l, item, productos) {
  if (!item) return { para: "", decidir: false };
  const p = productos.find((x) => x.id === item.producto_id) || { id: item.producto_id, nombre: item.nombre, unidad: item.unidad };
  const s = l.factor_sugerido;
  const calza = s && (UNIDAD_BASE(p.unidad) === s.unidad || UNIDAD_BASE(item.unidad) === s.unidad);
  const factor = factorDe(l) === 1 && calza ? s.factor : factorDe(l);
  // Si lo que trae el documento no es exactamente el producto con que se cotizó, se decide: el mismo o uno nuevo
  const decidir = !(l.producto && l.producto.id === p.id && l.calce !== "parecido");
  return { para: item.clave, accion: "existente", producto: { id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, precio_compra: Number(p.precio_compra) || 0, proveedor: p.proveedor }, calce: "exacto", factor, decidir };
}
// Lo que se manda al registrar: cantidad y precio en unidad base, y lo que el sistema debe recordar
export function presentacionParaEnviar(l, reparto) {
  const f = factorDe(l);
  const cant = Number(l.cantidad) || 0; const precio = Number(l.precio_neto) || 0;
  const aprender = l.accion === "existente" && l.producto && (f !== 1 || l.para || l.aprendido) ? { codigo_proveedor: l.codigo_proveedor || null, descripcion: l.descripcion, factor: f } : undefined;
  const para = /^[ovc]\d+$/.test(l.para || "") ? { tipo: { o: "orden", v: "venta", c: "complemento" }[l.para[0]], indice: Number(l.para.slice(1)) } : undefined;
  return {
    cantidad: cant * f, precio: f !== 1 ? precio / f : precio, aprender, para,
    presentacion: f !== 1 ? `${cant} × ${f} (${l.descripcion})` : undefined,
    reparto: reparto && f !== 1 ? reparto.map((r) => ({ ...r, cantidad: r.cantidad * f })) : reparto,
  };
}
// Al leer el documento: cada línea se conecta con la línea del pedido o de la venta que le corresponde.
// - Si el producto propuesto está en el pedido/venta, es ese (aunque el calce sea "parecido": es lo que compramos).
// - Si no, se busca entre los candidatos uno que esté en el pedido/venta y aún no tenga línea.
// - Si la descripción trae la presentación (5 LT, 2,23 M2…) y calza con la unidad, se pone el factor.
export function prepararLineas(lineas, items, productos) {
  const usados = new Set();
  const libre = (pid) => items.find((x) => x.producto_id === pid && !usados.has(x.clave));
  return lineas.map((l) => {
    let it = l.producto ? libre(l.producto.id) : null;
    let prod = l.producto;
    if (!it) for (const c of l.candidatos || []) { const x = libre(c.id); if (x) { it = x; prod = c; break; } }
    if (!it) return l;
    usados.add(it.clave);
    const base = { ...l, accion: "existente", producto: prod, calce: prod?.id === l.producto?.id ? l.calce : "parecido" };
    return Number(l.factor) > 1 ? { ...base, para: it.clave, decidir: base.calce === "parecido" } : { ...base, ...elegirPara(base, it, productos), calce: base.calce };
  });
}

export function PresentacionLinea({ l, items = [], complementos = [], productos, onChange }) {
  const f = factorDe(l);
  const u = l.producto ? UNIDAD_BASE(l.producto.unidad) : "";
  const s = l.factor_sugerido;
  const cant = Number(l.cantidad) || 0;
  const itPara = items.find((x) => x.clave === l.para);
  const pPara = itPara && (productos.find((x) => x.id === itPara.producto_id) || { id: itPara.producto_id, nombre: itPara.nombre });
  return (
    <div className="mini" style={{ marginTop: 4 }}>
      {l.decidir && pPara && <div className="aviso" style={{ margin: "4px 0", padding: "6px 8px" }}>
        <strong>¿Lo comprado es el mismo producto del catálogo con que se cotizó?</strong>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
          <button className="btn btn-ghost btn-sm" style={{ textAlign: "left" }} onClick={() => onChange({ accion: "existente", producto: { id: pPara.id, codigo: pPara.codigo, nombre: pPara.nombre, unidad: pPara.unidad, precio_compra: Number(pPara.precio_compra) || 0, proveedor: pPara.proveedor }, decidir: false })}>Sí, el mismo: guardar el precio en N° {pPara.codigo} {pPara.nombre}</button>
          <button className="btn btn-ghost btn-sm" style={{ textAlign: "left" }} onClick={() => onChange({ accion: "nuevo", nuevo: { ...(l.nuevo || {}), nombre: String(l.descripcion).toUpperCase(), unidad: (l.unidad || "UNIDAD").toUpperCase() }, decidir: false })}>No, crear producto nuevo: {String(l.descripcion).toUpperCase()}</button>
          <button className="btn btn-ghost btn-sm" style={{ textAlign: "left" }} onClick={() => onChange({ accion: "existente", decidir: false })}>Es otro del catálogo (lo elijo arriba)</button>
        </div>
        <div style={{ marginTop: 3 }}>En los tres casos la compra queda para «{itPara.nombre}» de la venta.</div>
      </div>}
      {(items.length > 0 || complementos.length > 0) && <div style={{ display: "flex", gap: 4, alignItems: "center" }}>Es para:
        <select className="select-linea" style={{ flex: 1, padding: "2px 4px" }} value={l.para || ""} onChange={(e) => {
          const v = e.target.value;
          // Complemento de una línea (ej. bisagras de la puerta): el producto queda como está y se agrega a la venta sin precio
          if (v.startsWith("c")) onChange({ para: v, decidir: false });
          else onChange(elegirPara(l, items.find((x) => x.clave === v), productos));
        }}>
          <option value="">— como está —</option>
          {items.map((x) => <option key={x.clave} value={x.clave}>{x.etiqueta}: {x.nombre} · {x.cantidad} {x.unidad || ""}</option>)}
          {complementos.length > 0 && <optgroup label="Complemento de (va con esa línea, se compra aparte)">
            {complementos.map((x) => <option key={`c${x.k}`} value={`c${x.k}`}>complemento de: {x.nombre}</option>)}
          </optgroup>}
        </select></div>}
      {String(l.para || "").startsWith("c") && <div style={{ color: "var(--accent)" }}>Se agrega a la venta como componente de «{complementos.find((x) => `c${x.k}` === l.para)?.nombre}»: sin precio para el cliente, su costo es de la venta.</div>}
      {l.accion === "existente" && l.producto && <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
        1 de la factura = <input className="qty-input" style={{ width: 54 }} type="number" min="0.01" step="any" value={l.factor ?? 1} onChange={(e) => onChange({ factor: e.target.value })} /> {u || "un"}
        {f === 1 && s && <button className="link" onClick={() => onChange({ factor: s.factor })}>usar × {String(s.factor).replace(".", ",")} ({String(s.factor).replace(".", ",")} {s.unidad} según la descripción)</button>}
        {f !== 1 && <strong style={{ color: "var(--accent)" }}>{cant} × {f} = {cant * f} {u} · {fmt(Math.round((Number(l.precio_neto) || 0) / f))} por {u.toLowerCase() || "unidad"}</strong>}
        {l.aprendido && <span title="Lo recordó de una factura anterior de este proveedor">· aprendido</span>}
      </div>}
      {(() => { const it = items.find((x) => x.clave === l.para) || (l.producto && items.find((x) => x.producto_id === l.producto.id)); if (!it) return null; const c = Math.round(cant * f * 1000) / 1000;
        if (c < it.cantidad && !Number.isInteger(c) && c >= it.cantidad * 0.97) return <div style={{ color: "var(--success)" }}>✓ completa lo pedido ({String(c).replace(".", ",")} de {it.cantidad}, por la presentación)</div>;
        return c > it.cantidad ? <div style={{ color: "var(--warn)" }}>⚠ se compraron {c} {u.toLowerCase()}, se pidieron {it.cantidad}: lo que sobra es compra extra</div>
          : c < it.cantidad ? <div style={{ color: "var(--warn)" }}>faltan {it.cantidad - c}: siguen "por comprar"</div> : <div style={{ color: "var(--success)" }}>✓ completa lo pedido ({it.cantidad})</div>; })()}
    </div>
  );
}

export const repartoParaEnviar = (l) => {
  if (!l.producto || l.producto.id !== l.reparto_de || !(l.reparto || []).length) return undefined;
  const cant = Number(l.cantidad) || 0;
  const r = (l.reparto || []).filter((x) => Number(x.cantidad) > 0).map((x) => ({ venta_id: x.venta_id, cantidad: Number(x.cantidad) }));
  const suma = r.reduce((s, x) => s + x.cantidad, 0);
  if (suma > cant) return undefined;
  if (suma < cant) r.push({ venta_id: null, cantidad: cant - suma });
  return r;
};

// Imprime directo la solicitud de cotización sencilla como hoja HTML: se ajusta al ancho del papel de la impresora
export async function imprimirSolicitud(lineas) {
  const d = await api("/ventas/solicitud-cotizacion", { method: "POST", body: { lineas, estilo: "simple", formato: "datos" } });
  const h = escaparHTML;
  const fact = d.facturacion.map((f) => `<div class="fact">${f.map((t, k) => {
    if (!k) return `<div class="fact-nom">${h(t)}</div>`;
    const m = /^(RUT|Giro):?\s*(.*)$/i.exec(t);
    return m ? `<div><b>${m[1].toUpperCase()}:</b> ${h(m[2])}</div>` : `<div>${h(t)}</div>`;
  }).join("")}</div>`).join("");
  const tabla = (sec) => {
    const llena = sec.lineas.some((l) => l.obs);
    return `<div class="grupo"><h2><span>${h(sec.titulo)}</span><span>${sec.lineas.length} producto(s)</span></h2>
    <table><colgroup><col style="width:30px"><col style="width:18px"><col><col style="width:70px"><col style="width:48px"><col style="width:${llena ? "26%" : "110px"}"></colgroup>
    <thead><tr><th class="num">N°</th><th class="chk"></th><th>Material</th><th class="cen">Unidad</th><th class="num">Cant.</th><th class="obs">${llena ? "Observación interna" : "Observación"}</th></tr></thead><tbody>
    ${sec.lineas.map((l, k) => `<tr><td class="num">${k + 1}</td><td class="chk">☐</td><td>${h(l.nombre)}</td><td class="cen">${h(l.unidad || "")}</td><td class="num">${l.cantidad}</td><td class="obs mini">${h(l.obs || "")}</td></tr>`).join("")}
    </tbody></table></div>`;
  };
  const cuerpo = `<style>.cab{display:flex;justify-content:space-between;gap:16px;margin-bottom:10px}.fact{border:1px solid #999;padding:6px 8px;font-size:9.5px}.fact+.fact{margin-top:6px}.fact-nom{font-weight:bold;font-size:11px}</style>
    <div class="cab"><div style="flex:1"><h1>${h(d.titulo)}</h1><div class="sub">Fecha: ${h(d.fecha)}<br>${d.proyectos.length > 1 ? "Proyectos" : "Proyecto"}: ${h(d.proyectos.join(" · "))}</div></div><div style="width:48%">${fact}</div></div>
    ${d.secciones.map(tabla).join("")}
    ${!d.secciones.length ? "<div class=\"pie\">Todos los productos marcados ya tienen orden de compra.</div>" : ""}`;
  imprimirHTML(d.titulo, cuerpo);
}

// Solicitud de cotización a proveedores (lineas: [{ venta_id, indice, cantidad? }]).
// Sencilla (blanco y negro, solo material, unidad y cantidad; lo que ya tiene orden sale bajo "Orden de compra C-00xx"):
// imprimir directo, PDF o Excel. Formal: con logo y colores de la empresa (PDF).
export function BotonesSolicitud({ lineas, notify, sm = true, vacio = "Selecciona los productos para la solicitud de cotización" }) {
  const [abierto, setAbierto] = useState(false);
  const pedir = (accion, estilo = "simple") => {
    const ls = typeof lineas === "function" ? lineas() : lineas;
    if (!ls.length) return notify(vacio, "danger");
    const body = { lineas: ls, estilo, formato: accion === "excel" ? "excel" : "pdf" };
    const p = accion === "imprimir" ? imprimirSolicitud(ls) : descargarPost("/ventas/solicitud-cotizacion", body);
    p.catch((e) => notify(e.message, "danger"));
  };
  const c = `btn btn-ghost${sm ? " btn-sm" : ""}`;
  return !abierto
    ? <button className={c} title="Lista de materiales con cantidades para pedir precio a proveedores (imprimir, PDF o Excel)" onClick={() => setAbierto(true)}>Solicitud de cotización ▸</button>
    : <span className="grupo-botones">
        <span className="mini">Solicitud:</span>
        <button className={c} title="Sencilla, blanco y negro" onClick={() => pedir("imprimir")}>🖨 Imprimir</button>
        <button className={c} onClick={() => pedir("pdf")}>↓ PDF</button>
        <button className={c} onClick={() => pedir("excel")}>↓ Excel</button>
        <button className={c} title="Con logo y colores de la empresa, para enviar formal" onClick={() => pedir("pdf", "formal")}>↓ Formal (logo)</button>
        <button className="link mini" title="Cerrar" onClick={() => setAbierto(false)}>✕</button>
      </span>;
}

// Empresa que compra: a nombre de quién viene la factura. Su IVA se descuenta en esa empresa, así que se elige
// con dos botones bien distintos y un aviso. "detectada" es lo que leyó el sistema en el documento (o null).
const NOMBRE_EMPRESA = { kenott: "Kenott", tactics: "Tactics" };
export function EmpresaCompra({ valor, onChange, detectada = null, ventaEmpresa = null, conDocumento = true }) {
  let aviso;
  if (detectada && valor === detectada) aviso = <span className="ok">✓ La factura viene a nombre de {NOMBRE_EMPRESA[detectada]}: su IVA queda en {NOMBRE_EMPRESA[detectada]}.</span>;
  else if (detectada && valor && valor !== detectada) aviso = <span className="mal">⚠ La factura viene a nombre de {NOMBRE_EMPRESA[detectada]} y elegiste {NOMBRE_EMPRESA[valor]}: el IVA de las dos empresas quedaría descuadrado.</span>;
  else if (!valor) aviso = <span className="mal">⚠ {conDocumento ? "No se ve en el documento a nombre de quién viene. " : ""}Revisa la factura y elige la empresa que compra.</span>;
  else aviso = <span>{conDocumento ? "No se vio en el documento a nombre de quién viene: confirma que sea " : "Confirma que la factura venga a nombre de "}{NOMBRE_EMPRESA[valor]}.</span>;
  return (
    <div className={`field campo-clave empresa-compra ${valor ? "" : "vacio"}`}>
      <label>★ Empresa que compra</label>
      <div className="empresa-botones">
        {["kenott", "tactics"].map((e) => (
          <button key={e} type="button" className={`empresa-btn ${e} ${valor === e ? "activo" : ""}`} onClick={() => onChange(e)}>
            {valor === e ? "● " : "○ "}{NOMBRE_EMPRESA[e]}{detectada === e ? " (en la factura)" : ""}
          </button>
        ))}
      </div>
      <div className="empresa-aviso">
        {aviso}
        {ventaEmpresa && valor && ventaEmpresa !== valor && <div>La venta es de {NOMBRE_EMPRESA[ventaEmpresa]}; esta compra queda en {NOMBRE_EMPRESA[valor]} (puede ser, solo revísalo).</div>}
        <div>Independiente de quién facture la venta, el IVA de esta compra va a la empresa que figura en la factura.</div>
      </div>
    </div>
  );
}

// Aviso de los datos que quedan en la contabilidad (IVA, por pagar): se llenan con la factura en mano
export function AvisoCamposClave() {
  return <div className="aviso-clave">★ Los campos marcados quedan en la contabilidad (IVA y por pagar de cada empresa): revísalos con la factura en mano.</div>;
}

// Control de la suma de las líneas contra el total del documento (neto). Si no cuadra suele ser un descuento
// (o recargo) a todo el documento: el botón lo reparte en el precio de cada línea, en proporción.
export function CuadreDocumento({ control, lineas, onAplicar }) {
  const ref = Number(control?.total_documento) || 0;
  if (!ref) return <span className="mini">El documento no muestra total para comprobar.</span>;
  // Si los precios venían con IVA, el total de referencia es con IVA y las líneas ya están netas
  const suma = Math.round(lineas.reduce((s, l) => s + Number(l.cantidad || 0) * Number(l.precio_neto || 0), 0) * (control.precios_incluyen_iva ? 1.19 : 1));
  const tol = Math.max(2, ref * 0.01);
  if (Math.abs(suma - ref) <= tol) return <span className="estado estado-ok">✓ La suma de las líneas cuadra con el total del documento ({fmt(ref)})</span>;
  const factor = ref / (suma || 1);
  const pct = Math.round(Math.abs(1 - factor) * 1000) / 10;
  return (
    <span className="estado estado-warn" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      ⚠ La suma de las líneas ({fmt(suma)}) no cuadra con el documento ({fmt(ref)}): diferencia {fmt(Math.abs(suma - ref))} ({pct}%).
      {suma > 0 && pct <= 40 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => onAplicar(factor)}
        title="Si el documento trae un descuento (o recargo) para todo el total, se reparte en el precio de cada línea">
        {factor < 1 ? `Aplicar descuento de ${pct}% a las líneas` : `Aplicar recargo de ${pct}% a las líneas`}</button>}
      <span style={{ fontWeight: 400, textTransform: "none" }}>Si no es un descuento general, revisa la cantidad o el precio de alguna línea.</span>
    </span>
  );
}
// Reparte el factor en los precios netos (redondeados)
export const aplicarFactorPrecios = (lineas, factor) => lineas.map((l) => ({ ...l, precio_neto: Math.round(Number(l.precio_neto || 0) * factor) }));
// Montos del encabezado después de repartir: neto = suma de líneas
export function montosTrasFactor(lineas, control) {
  const neto = Math.round(lineas.reduce((s, l) => s + Number(l.cantidad || 0) * Number(l.precio_neto || 0), 0));
  const iva = Math.round(neto * 0.19);
  return { neto, iva, total: control?.precios_incluyen_iva && control.total_documento ? Math.round(control.total_documento) : neto + iva };
}
