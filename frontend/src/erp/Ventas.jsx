import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Estado, ItemsEditor, Totales, PagosPanel, Etapa, EstadoFactura, confirmar, pedirTexto, imprimirSolicitud } from "./ui";
import { api, fmt, fecha, useProductos, precioSegun, TIPOS_GASTO, imprimirPDF, imprimirHTML, escaparHTML as h, nombreArchivo } from "./lib";
import CuadroCompra, { imprimirCuadro } from "./CuadroCompra";
import { cuerpoOrden } from "./Compras";
import { AccionesVenta, PanelFacturas, HistorialVenta, conConfirmacion } from "./Recorrido";
import { RespaldoVenta, BadgeRespaldo } from "./Respaldo";

// Períodos para filtrar (fechas en hora local de Chile)
const PERIODOS = [["todo", "Todas las fechas"], ["mes", "Este mes"], ["mes_pasado", "Mes pasado"], ["anio", "Este año"]];
const iso = (d) => d.toLocaleDateString("sv-SE");
function rangoPeriodo(p) {
  const hoy = new Date();
  if (p === "mes") return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)];
  if (p === "mes_pasado") return [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0))];
  if (p === "anio") return [iso(new Date(hoy.getFullYear(), 0, 1)), iso(hoy)];
  return [null, null];
}

// Filtros por etapa del recorrido, según el departamento
const FILTROS_ETAPA = {
  comercial: [["", "Todas"], ["registrada,aceptada", "En proceso"], ["lista,despachada,entregada", "Listas o despachadas"], ["entregada", "Entregadas"]],
  operativo: [["registrada,aceptada", "Por ejecutar"], ["registrada", "Por aceptar"], ["aceptada", "En compra"], ["lista", "Productos listos"], ["", "Todas"]],
  finanzas: [["", "Todas"]],
};

// modo: comercial (registra ventas, sin costos) | operativo (ventas por ejecutar: aceptar, comprar, confirmar) | finanzas (cobros y márgenes)
export default function Ventas({ notify, esAdmin, puedeOperar, puedeVender, modo = "comercial", clientes, abrirVentaId, onAbierta, irACompra }) {
  const verCompras = puedeOperar && modo !== "comercial";
  const verCobros = esAdmin && modo === "finanzas";
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroPago, setFiltroPago] = useState("");
  const [etapa, setEtapa] = useState(FILTROS_ETAPA[modo]?.[0]?.[0] ?? "");
  const [busqueda, setBusqueda] = useState("");
  const [periodo, setPeriodo] = useState("todo"); // todo | mes | mes_pasado | anio
  const [nueva, setNueva] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [soloFaltan, setSoloFaltan] = useState(false); // ventas a las que les falta cedible o guía recepcionada

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filtroPago) p.append("estado_pago", filtroPago);
      if (etapa) { p.append("etapa", etapa); p.append("estado", "emitida"); }
      if (busqueda) p.append("busqueda", busqueda);
      const [desde, hasta] = rangoPeriodo(periodo);
      if (desde) p.append("desde", desde);
      if (hasta) p.append("hasta", hasta);
      setVentas(await api(`/ventas?${p}`));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [filtroPago, etapa, busqueda, periodo, notify]);

  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  // Venta abierta ahora: si se cierra mientras se recarga (ej. al cerrar el cuadro de compra), no se vuelve a abrir
  const abierta = useRef(null);
  const verDetalle = useCallback(async (id, { refrescar = false } = {}) => {
    if (refrescar && abierta.current !== id) return;
    abierta.current = id;
    try { const v = await api(`/ventas/${id}`); if (abierta.current === id) setDetalle(v); } catch (e) { notify(e.message, "danger"); }
  }, [notify]);

  // Permite abrir una venta desde otra vista (tareas de Inicio, Cotizaciones...)
  useEffect(() => {
    if (abrirVentaId) { verDetalle(abrirVentaId); onAbierta?.(); }
  }, [abrirVentaId, verDetalle, onAbierta]);

  const activas = ventas.filter((v) => v.estado !== "anulada");
  const porCobrar = activas.reduce((s, v) => s + Number(v.total) - Number(v.monto_pagado), 0);
  const cuenta = (...e) => activas.filter((v) => e.includes(v.etapa)).length;
  const filtros = FILTROS_ETAPA[modo] || FILTROS_ETAPA.comercial;
  const conFaltantes = activas.filter((v) => v.respaldo?.faltan?.length).length;
  const listadas = soloFaltan ? ventas.filter((v) => v.respaldo?.faltan?.length) : ventas;

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Ventas listadas</div><div className="stat-value">{activas.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total (con IVA)</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.total), 0))}</div></div>
        {esAdmin && modo === "finanzas"
          ? <div className="stat-card"><div className="stat-label">Margen neto</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.subtotal) - Number(v.costo_total), 0))}</div></div>
          : <div className="stat-card"><div className="stat-label">{modo === "operativo" ? "Por aceptar" : "En proceso (compra)"}</div><div className="stat-value">{modo === "operativo" ? cuenta("registrada") : cuenta("registrada", "aceptada")}</div></div>}
        {modo === "finanzas"
          ? <div className="stat-card"><div className="stat-label">Por cobrar</div><div className="stat-value" style={{ color: porCobrar > 0 ? "var(--danger)" : "var(--success)", fontSize: 16 }}>{fmt(porCobrar)}</div></div>
          : <div className="stat-card"><div className="stat-label">{modo === "operativo" ? "En compra" : "Sin factura (listas)"}</div><div className="stat-value">{modo === "operativo" ? cuenta("aceptada") : activas.filter((v) => ["lista", "despachada", "entregada"].includes(v.etapa) && v.estado_factura !== "facturada").length}</div></div>}
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N°, ID, OC, cliente o factura..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        {filtros.length > 1 && (
          <div className="chips">
            {filtros.map(([v, t]) => <button key={t} className={`chip ${etapa === v ? "activo" : ""}`} onClick={() => setEtapa(v)}>{t}</button>)}
          </div>
        )}
        <select className="filter-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)} title="Período de las ventas listadas">
          {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {modo === "finanzas" && (
          <select className="filter-select" value={filtroPago} onChange={(e) => setFiltroPago(e.target.value)}>
            <option value="">Todas</option>
            <option value="pendiente">Pendientes de pago</option>
            <option value="parcial">Pago parcial</option>
            <option value="pagada">Pagadas</option>
          </select>
        )}
        {(conFaltantes > 0 || soloFaltan) && <button className={`chip chip-falta ${soloFaltan ? "activo" : ""}`} title="Ventas despachadas o facturadas sin la cedible o la guía firmada por el cliente"
          onClick={() => setSoloFaltan(!soloFaltan)}>⚠ Faltan doc. cedibles / guías ({conFaltantes})</button>}
        {puedeVender && modo === "comercial" && <button className="btn btn-primary" onClick={() => setNueva(true)}>+ Nueva venta</button>}
      </div>
      {modo === "operativo" && <div className="mini" style={{ marginTop: -8, marginBottom: 10 }}>Abre una venta para aceptarla, ver qué comprar (Cuadro de compra) y, cuando llegue todo, confirmarla para que Comercial facture.</div>}

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>OC / ID</th><th>Etapa</th>{modo !== "operativo" && <th>Factura</th>}<th>Total</th>{modo === "finanzas" && <th>Saldo</th>}{modo === "finanzas" && <th>Vence</th>}{modo === "finanzas" && <th>Pago</th>}{modo === "operativo" && <th>Compras</th>}<th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={11}><span className="spinner"></span>Cargando...</td></tr>
              : listadas.length === 0 ? <tr className="empty-row"><td colSpan={11}>// sin ventas en este filtro</td></tr>
              : listadas.map((v) => {
                const saldo = Number(v.total) - Number(v.monto_pagado);
                const vencida = v.estado !== "anulada" && saldo > 0 && v.fecha_vencimiento && v.fecha_vencimiento < new Date().toLocaleDateString("sv-SE");
                return (
                  <tr key={v.id} className={v.estado === "anulada" ? "fila-anulada" : ""}>
                    <td className="id-cell">{v.numero}{v.empresa === "tactics" && <div><Estado valor="tactics" /></div>}</td>
                    <td className="mini">{fecha(v.fecha)}</td>
                    <td>{v.cliente_nombre || <span className="mini">Sin cliente</span>}</td>
                    <td className="mini">{v.orden_compra_cliente || (v.oc_pendiente ? <span className="estado estado-warn">OC pendiente</span> : "—")}{v.id_solicitud && <div className="id-solicitud">ID {v.id_solicitud}</div>}</td>
                    <td>{v.estado === "anulada" ? <Estado valor="anulada" /> : <Etapa valor={v.etapa} />}{v.estado !== "anulada" && <div style={{ marginTop: 3 }}><BadgeRespaldo respaldo={v.respaldo} /></div>}</td>
                    {modo !== "operativo" && <td className="mini"><EstadoFactura valor={v.estado_factura} />{v.documento && <div>{v.documento}</div>}</td>}
                    <td className="price-cell">{fmt(v.total)}</td>
                    {modo === "finanzas" && <td className="price-cell" style={{ color: saldo > 0.5 ? "var(--text)" : "var(--text3)" }}>{fmt(saldo)}</td>}
                    {modo === "finanzas" && <td className={`mini ${vencida ? "stock-low" : ""}`}>{fecha(v.fecha_vencimiento)}{vencida ? " ⚠" : ""}</td>}
                    {modo === "finanzas" && <td><Estado valor={v.estado === "anulada" ? "anulada" : v.estado_pago} /></td>}
                    {modo === "operativo" && <td className="mini">{!v.compras?.ordenes ? <span style={{ color: "var(--warn)" }}>por comprar</span> : `${v.compras.recibidas}/${v.compras.ordenes} recibidas`}</td>}
                    <td><div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => verDetalle(v.id)}>{modo === "operativo" && v.estado !== "anulada" ? "Ejecutar acciones" : "Ver"}</button>
                      {modo === "operativo" && v.estado !== "anulada" && (v.items || []).length > 0 && <button className="btn btn-ghost btn-sm" title="Imprime directo el detalle de materiales (solicitud de cotización sencilla)"
                        onClick={() => imprimirSolicitud(v.items.map((_, k) => ({ venta_id: v.id, indice: k }))).catch((e) => notify(e.message, "danger"))}>🖨 Imprimir compra cot.</button>}
                    </div></td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {nueva && <NuevaVenta clientes={clientes} notify={notify} onClose={() => setNueva(false)} onCreada={(v) => { setNueva(false); cargar(); verDetalle(v.id); }} />}
      {detalle && <DetalleVenta venta={detalle} modo={modo} esAdmin={esAdmin} verCompras={verCompras} verCobros={verCobros} puedeOperar={puedeOperar} puedeVender={puedeVender} notify={notify} irACompra={irACompra} onClose={() => { abierta.current = null; setDetalle(null); }} onCambio={() => { cargar(); verDetalle(detalle.id, { refrescar: true }); }} />}
    </>
  );
}

function NuevaVenta({ clientes, notify, onClose, onCreada }) {
  const productos = useProductos();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ empresa: "kenott", cliente_id: "", cliente_nombre: "", id_solicitud: "", orden_compra_cliente: "", dias_credito: 30, pagada_al_contado: false, medio_pago: "efectivo", notas: "" });
  const cli = clientes.find((c) => String(c.id) === String(form.cliente_id));
  const tipo = cli?.tipo || "convenio";
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      const v = await conConfirmacion("/ventas", {
        ...form,
        cliente_id: form.cliente_id ? Number(form.cliente_id) : null,
        cliente_nombre: cli?.codigo === "P-001" ? form.cliente_nombre || null : null,
        dias_credito: form.pagada_al_contado ? 0 : Number(form.dias_credito),
        items: items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), precio: Number(i.precio) })),
      });
      notify(`✓ Venta ${v.numero} registrada`);
      onCreada(v);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo="// Nueva venta" onClose={onClose} ancho={720}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || items.length === 0} onClick={guardar}>{guardando ? "Guardando..." : "Registrar venta"}</button>
      </>}>
      <div className="chips">
        {[["kenott", "Inversiones Kenott"], ["tactics", "Tactics Inversiones"]].map(([v, t]) => (
          <button key={v} className={`chip ${form.empresa === v ? "activo" : ""}`} onClick={() => setForm({ ...form, empresa: v })}>{form.empresa === v ? "● " : ""}{t}</button>
        ))}
      </div>
      <div className="fields-row">
        <div className="field">
          <label>Cliente</label>
          <select value={form.cliente_id} onChange={(e) => {
            // El plazo de pago viene de la ficha del cliente
            const c = clientes.find((x) => String(x.id) === e.target.value);
            setForm({ ...form, cliente_id: e.target.value, dias_credito: c ? c.plazo_pago_dias ?? 30 : 30 });
          }}>
            <option value="">— Sin cliente —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ""}{c.nombre}</option>)}
          </select>
          {cli?.codigo === "P-001" && <input style={{ marginTop: 6 }} value={form.cliente_nombre} onChange={(e) => setForm({ ...form, cliente_nombre: e.target.value })} placeholder="Nombre del cliente para esta venta" />}
        </div>
        <div className="field">
          <label>ID del cliente o de la solicitud</label>
          <input value={form.id_solicitud} onChange={(e) => setForm({ ...form, id_solicitud: e.target.value })} placeholder={cli?.codigo && cli.codigo !== "P-001" ? `${cli.codigo} (del cliente)` : "Ej: 1422-20-COT26"} />
        </div>
      </div>
      <div className="fields-row">
        <div className="field">
          <label>N° orden de compra del cliente (si no hay OC, se identifica con el ID)</label>
          <input value={form.orden_compra_cliente} onChange={(e) => setForm({ ...form, orden_compra_cliente: e.target.value })} placeholder="Ej: 2401-55-SE26" />
        </div>
      </div>
      <div className="mini">Precio sugerido: <Estado valor={tipo} /> · lo puedes corregir por línea.</div>
      <ItemsEditor key={tipo} items={items} setItems={setItems} productos={productos} precioDe={(p) => precioSegun(p, tipo)} />
      <div className="mini">La factura no se pide ahora: Operativo acepta y compra, y cuando estén los productos se factura en Facturación.</div>
      <div className="fields-row">
        <label className="check">
          <input type="checkbox" checked={form.pagada_al_contado} onChange={(e) => setForm({ ...form, pagada_al_contado: e.target.checked })} />
          Pagada al contado
        </label>
        {form.pagada_al_contado ? (
          <div className="field">
            <label>Medio de pago</label>
            <select value={form.medio_pago} onChange={(e) => setForm({ ...form, medio_pago: e.target.value })}>
              {["efectivo", "transferencia", "tarjeta", "cheque"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
        ) : (
          <div className="field">
            <label>Plazo de pago (días){cli ? ` · ficha: ${cli.plazo_pago_dias ?? 30}${cli.base_vencimiento === "recepcion" ? " desde recepción" : ""}` : ""}</label>
            <input type="number" min="0" value={form.dias_credito} onChange={(e) => setForm({ ...form, dias_credito: e.target.value })} />
          </div>
        )}
      </div>
    </Modal>
  );
}

// Imprimir desde la venta: cotización, interna simple (costos), cuadro de compra y órdenes de compra
function ImprimirVenta({ venta, esAdmin, verCompras, notify }) {
  const [abierto, setAbierto] = useState(false);
  const hacer = (fn) => Promise.resolve().then(fn).catch((e) => notify(e.message, "danger"));
  const ordenes = async () => {
    const os = (await api(`/ordenes-compra?venta_id=${venta.id}`)).filter((o) => o.estado !== "anulada");
    if (!os.length) return notify("Esta venta aún no tiene órdenes de compra", "danger");
    imprimirHTML(nombreArchivo("Ordenes de compra", venta.numero, venta.cliente_nombre, venta.orden_compra_cliente ? `OC ${venta.orden_compra_cliente}` : ""), os.map((o, k) => `<div${k ? ' style="page-break-before:always"' : ""}>${cuerpoOrden(o)}</div>`).join(""));
  };
  if (!abierto) return <button className="btn btn-ghost" title="Cotización, interna simple, cuadro de compra u órdenes de compra" onClick={() => setAbierto(true)}>🖨 Imprimir ▸</button>;
  return (
    <span className="grupo-botones">
      {venta.cotizacion_id && <button className="btn btn-ghost btn-sm" onClick={() => hacer(() => imprimirPDF(`/cotizaciones/${venta.cotizacion_id}/pdf`, null, nombreArchivo("Cotizacion", venta.numero, venta.cliente_nombre)))}>Cotización</button>}
      {esAdmin && <button className="btn btn-ghost btn-sm" title="Cotizado, caso, venta, compra, 3 mejores proveedores y utilidad" onClick={() => hacer(() => imprimirInternaSimple(venta.id))}>Interna simple</button>}
      {verCompras && <button className="btn btn-ghost btn-sm" onClick={() => hacer(() => imprimirCuadro(venta.id, esAdmin))}>Cuadro de compra</button>}
      {verCompras && <button className="btn btn-ghost btn-sm" onClick={() => hacer(ordenes)}>Órdenes de compra</button>}
      <button className="link mini" title="Cerrar" onClick={() => setAbierto(false)}>✕</button>
    </span>
  );
}

// Hoja interna simple de la venta (no se entrega al cliente)
async function imprimirInternaSimple(ventaId) {
  const d = await api(`/ventas/${ventaId}/interna-simple`);
  const v = d.venta; const t = d.totales;
  const $ = (n) => (n == null ? "" : fmt(n));
  const prov = (o) => (o ? `<td${o.usado ? ' style="font-weight:bold"' : ""}>${h(o.proveedor)}</td><td class="num"${o.usado ? ' style="font-weight:bold"' : ""}>${$(o.precio)}</td>` : "<td></td><td></td>");
  const cuerpo = `<h1>Interna simple · ${h(v.numero)} · ${h(v.cliente || "Sin cliente")}</h1>
    <div class="sub">${[v.empresa === "tactics" ? "Tactics" : "Kenott", v.orden_compra_cliente ? `OC ${h(v.orden_compra_cliente)}` : "", v.id_solicitud ? `ID ${h(v.id_solicitud)}` : "", "NO ENTREGAR AL CLIENTE"].filter(Boolean).join(" · ")}</div>
    <table style="font-size:9px"><colgroup><col style="width:24px"><col><col style="width:52px"><col style="width:56px"><col style="width:56px"><col style="width:66px"><col style="width:52px"><col style="width:66px"><col style="width:52px"><col style="width:66px"><col style="width:52px"><col style="width:34px"><col style="width:62px"><col style="width:62px"><col style="width:58px"><col style="width:40px"></colgroup>
    <thead><tr><th class="num">N°</th><th>Producto cotizado</th><th class="cen">Caso</th><th class="num">P. venta</th><th class="num">P. compra</th><th>Proveedor 1</th><th class="num">$</th><th>Proveedor 2</th><th class="num">$</th><th>Proveedor 3</th><th class="num">$</th><th class="num">Cant.</th><th class="num">T. venta</th><th class="num">T. compra</th><th class="num">Utilidad</th><th class="num">%</th></tr></thead><tbody>
    ${d.filas.map((f) => `<tr${f.caso === "similar" ? ' style="background:#fff2cc"' : f.caso === "nuevo" ? ' style="background:#f8d7da"' : ""}><td class="num">${f.n}</td><td>${h(f.producto)}${f.parecido ? `<div class="mini">≈ precios de ${h(f.parecido)}</div>` : ""}</td><td class="cen">${h(f.caso_txt)}</td><td class="num">${$(f.precio)}</td><td class="num">${f.costo ? $(f.costo) : "sin precio"}</td>${[0, 1, 2].map((n) => prov(f.proveedores[n])).join("")}<td class="num">${f.cantidad}</td><td class="num">${$(f.total_venta)}</td><td class="num">${$(f.total_compra)}</td><td class="num"${f.utilidad < 0 ? ' style="color:#c00;font-weight:bold"' : ""}>${$(f.utilidad)}</td><td class="num">${f.margen ?? ""}</td></tr>`).join("")}
    </tbody></table>
    <div class="pie">Venta neta <strong>${fmt(t.venta)}</strong> · compra neta <strong>${fmt(t.compra)}</strong> · utilidad <strong>${fmt(t.utilidad)}</strong>${t.margen != null ? ` (${t.margen}%)` : ""}${t.sin_costo ? ` · ${t.sin_costo} línea(s) sin precio de compra no suman` : ""}</div>
    <div class="mini">En negrita, el proveedor de la línea. Caso: Exacto = mismo producto · Similar = equivalente · Sin catálogo = precio a mano. ≈ = el producto no tiene precios en el catálogo; se muestran los de un producto parecido.</div>`;
  imprimirHTML(nombreArchivo("Interna simple", v.numero, v.cliente_nombre || v.cliente, v.orden_compra_cliente ? `OC ${v.orden_compra_cliente}` : ""), cuerpo, { horizontal: true });
}

// Cambiar el producto de una línea de la venta (el cliente cambió de opinión). La cotización queda como se envió.
function CambiarProducto({ venta, indice, verCompras, notify, onClose, onHecho }) {
  const linea = venta.items[indice];
  const productos = useProductos();
  const [q, setQ] = useState("");
  const [elegido, setElegido] = useState(null);
  const [precio, setPrecio] = useState(String(Math.round(linea.precio)));
  const [cantidad, setCantidad] = useState(String(linea.cantidad));
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Medidas escritas distinto valen igual: 1 1/2 = 1.1/2 = 1-1/2 ; 1/2X1 = 1/2 X 1
  const norm = (x) => String(x).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/(\d)X(\d)/g, "$1 X $2").replace(/(^|[^0-9A-Z./])(\d+)(?:\s+|-|\.)(\d+\/\d+)/g, "$1$2.$3").replace(/"/g, "");
  const palabras = norm(q.trim()).split(/\s+/).filter(Boolean);
  const lista = palabras.length ? productos.filter((p) => { const t = norm(`${p.codigo} ${p.nombre}`); return p.activo !== false && palabras.every((w) => t.includes(w)); }).slice(0, 25) : [];
  const guardar = async () => {
    if (!motivo.trim()) return notify("Escribe el motivo del cambio", "danger");
    setEnviando(true);
    try {
      const r = await api(`/ventas/${venta.id}/cambiar-producto`, { method: "POST", body: { indice, producto_id: elegido.id, precio, cantidad, motivo } });
      notify(`✓ ${linea.nombre} → ${elegido.nombre}${r.total_cambio ? ` · el total neto cambia ${r.total_cambio > 0 ? "+" : ""}${fmt(r.total_cambio)}` : ""}`);
      onHecho();
    } catch (e) { notify(e.message, "danger"); setEnviando(false); }
  };
  return (
    <Modal titulo="// Cambiar producto de la venta" onClose={onClose} ancho={680}
      footer={<>{elegido && <button className="btn btn-primary" disabled={enviando} onClick={guardar}>Cambiar producto</button>}<button className="btn btn-ghost" onClick={onClose}>Cancelar</button></>}>
      <div style={{ marginBottom: 10 }}>Ahora: <strong>{linea.nombre}</strong> <span className="mini">· {linea.cantidad} {linea.unidad} · {fmt(linea.precio)} c/u</span></div>
      <div className="mini" style={{ marginBottom: 10 }}>Úsalo cuando el cliente cambia de opinión. Cambia la venta y lo que hay que comprar; la cotización queda como se envió. Si la línea ya tiene orden de compra, primero anula o descarta esa orden.</div>
      {!elegido ? <>
        <input autoFocus className="input-mini" style={{ width: "100%", padding: "6px 8px", marginBottom: 6 }} placeholder="Buscar producto nuevo (ej. perno 1/2 1.1/2)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {lista.map((p) => (
            <button key={p.id} className="fila-elegir" onClick={() => setElegido(p)}>
              <span>{p.nombre} <span className="mini">· N° {p.codigo} · {p.unidad}</span></span>
              {verCompras && <span className="mini">{Number(p.precio_compra) > 0 ? `${fmt(p.precio_compra)} ${p.proveedor || ""}` : "sin precio"}</span>}
            </button>
          ))}
          {palabras.length > 0 && !lista.length && <div className="mini">No hay productos con esas palabras. Si no existe, agrégalo primero en Catálogo.</div>}
        </div>
      </> : <>
        <div style={{ marginBottom: 8 }}>Nuevo: <strong>{elegido.nombre}</strong> <span className="mini">· {elegido.unidad}{verCompras ? ` · compra ${Number(elegido.precio_compra) > 0 ? fmt(elegido.precio_compra) : "sin precio"}` : ""}</span> <button className="link mini" onClick={() => setElegido(null)}>cambiar</button></div>
        <div className="fields-row">
          <div className="field"><label>Precio de venta c/u (neto)</label><input value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d]/g, ""))} /></div>
          <div className="field" style={{ maxWidth: 140 }}><label>Cantidad</label><input value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))} /></div>
        </div>
        <div className="field"><label>Motivo (queda en el historial)</label><input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cliente pidió pernos de 1 1/2 en vez de 1 1/4" /></div>
        {Number(precio) * Number(cantidad) !== Number(linea.precio) * Number(linea.cantidad) && <div className="aviso">El total de la venta cambia {fmt(Number(precio) * Number(cantidad) - Number(linea.precio) * Number(linea.cantidad))} neto. Si ya hay factura, revisa la facturación.</div>}
      </>}
    </Modal>
  );
}

function DetalleVenta({ venta, modo, esAdmin, verCompras, verCobros, puedeOperar, puedeVender, notify, onClose, onCambio, irACompra }) {
  const [cuadro, setCuadro] = useState(false);
  const [cambiar, setCambiar] = useState(null); // índice de la línea a cambiar de producto
  const puedeCambiar = venta.estado !== "anulada" && (puedeVender || puedeOperar);
  const editaDatos = puedeVender && modo === "comercial";
  const [datos, setDatos] = useState({ plazo_pago_dias: venta.plazo_pago_dias ?? "", base_vencimiento: venta.base_vencimiento || "factura", orden_compra_cliente: venta.orden_compra_cliente || "", id_solicitud: venta.id_solicitud || "", cliente_id: venta.cliente_id || "" });
  const r = venta.resumen;
  const [clientes, setClientes] = useState([]);
  useEffect(() => { if (editaDatos) api("/clientes").then((l) => setClientes(Array.isArray(l) ? l : l?.clientes || [])).catch(() => {}); }, [editaDatos]);

  const accion = async (fn, ok) => {
    try { await fn(); notify(ok); onCambio(); } catch (e) { notify(e.message, "danger"); }
  };
  const [anulando, setAnulando] = useState(false);
  const anular = () => setAnulando(true);
  const guardarDatos = () => {
    // El plazo solo se manda si cambió (recalcula el vencimiento)
    const { plazo_pago_dias, base_vencimiento, ...resto } = datos;
    const body = { ...resto };
    if (String(body.cliente_id || "") === String(venta.cliente_id || "")) delete body.cliente_id;
    if (String(plazo_pago_dias) !== String(venta.plazo_pago_dias ?? "") && plazo_pago_dias !== "") body.plazo_pago_dias = Number(plazo_pago_dias);
    if (base_vencimiento !== (venta.base_vencimiento || "factura")) body.base_vencimiento = base_vencimiento;
    accion(() => api(`/ventas/${venta.id}/datos`, { method: "PUT", body }), "✓ Datos guardados");
  };
  const cambioDatos = String(datos.plazo_pago_dias) !== String(venta.plazo_pago_dias ?? "") || datos.base_vencimiento !== (venta.base_vencimiento || "factura") || datos.orden_compra_cliente !== (venta.orden_compra_cliente || "") || datos.id_solicitud !== (venta.id_solicitud || "") || String(datos.cliente_id || "") !== String(venta.cliente_id || "");

  return (
    <Modal titulo={`// Venta ${venta.numero}`} onClose={onClose} ancho={780}
      footer={<>
        {esAdmin && venta.estado !== "anulada" && <button className="btn btn-danger" onClick={anular}>Anular venta</button>}
        {anulando && <AnularVenta venta={venta} notify={notify} onClose={() => setAnulando(false)} onHecho={() => { setAnulando(false); onCambio(); }} />}
        <ImprimirVenta venta={venta} esAdmin={esAdmin} verCompras={verCompras} notify={notify} />
        {verCompras && venta.estado !== "anulada" && <button className="btn btn-primary" onClick={() => setCuadro(true)}>Cuadro de compra</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      {venta.estado === "anulada" && venta.motivo_anulacion && <div className="aviso">Anulada{venta.anulada_por ? ` por ${venta.anulada_por}` : ""}{venta.anulada_fecha ? ` el ${fecha(venta.anulada_fecha)}` : ""}: {venta.motivo_anulacion}</div>}
      <div className="hist-meta">
        <span>{fecha(venta.fecha)}</span>
        <span>{venta.cliente_nombre || "Sin cliente"}</span>
        {venta.id_solicitud && <span className="id-solicitud">ID {venta.id_solicitud}</span>}
        {venta.plazo_pago_dias != null && <span>Plazo {Number(venta.plazo_pago_dias) === 0 ? "contado" : `${venta.plazo_pago_dias} días desde ${venta.base_vencimiento === "recepcion" ? "la recepción" : "la factura"}`}</span>}
        {venta.fecha_vencimiento && <span>Vence {fecha(venta.fecha_vencimiento)}</span>}
        {venta.creado_por && <span>Por {venta.creado_por}</span>}
        {venta.orden_compra_cliente && <span>OC {venta.orden_compra_cliente}</span>}
        {venta.oc_pendiente && <span className="estado estado-warn" title="Se sabe que viene la OC, pero aún no llega">OC pendiente</span>}
        {venta.oc_pendiente && venta.estado !== "anulada" && editaDatos && <button className="btn btn-primary btn-sm" onClick={async () => {
          const oc = await pedirTexto(`N° de orden de compra de ${venta.numero}`, { titulo: "Registrar OC", placeholder: "Ej: 3385-400-SE26", obligatorio: true });
          if (oc) accion(() => api(`/ventas/${venta.id}/datos`, { method: "PUT", body: { orden_compra_cliente: oc } }), `✓ OC ${oc} registrada`);
        }}>Registrar OC</button>}
        <Estado valor={venta.empresa || "kenott"} /> {venta.estado === "anulada" && <Estado valor="anulada" />} {verCobros && <Estado valor={venta.estado_pago} />}
      </div>
      {venta.notas && <div className="mini">{venta.notas}</div>}
      <AccionesVenta venta={venta} puedeOperar={puedeOperar && modo !== "comercial"} puedeVender={puedeVender && modo !== "operativo"} esAdmin={esAdmin} notify={notify} onCambio={onCambio}
        abrirCuadro={null} />
      {venta.estado !== "anulada" && editaDatos && (
        <div className="fields-row">
          <div className="field">
            <label>N° orden de compra del cliente</label>
            <input value={datos.orden_compra_cliente} onChange={(e) => setDatos({ ...datos, orden_compra_cliente: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Plazo (días)</label>
            <input type="number" min="0" value={datos.plazo_pago_dias} onChange={(e) => setDatos({ ...datos, plazo_pago_dias: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>Desde</label>
            <select value={datos.base_vencimiento} onChange={(e) => setDatos({ ...datos, base_vencimiento: e.target.value })}>
              <option value="factura">la factura</option><option value="recepcion">la recepción</option>
            </select>
          </div>
          <div className="field">
            <label>Cliente</label>
            <select value={datos.cliente_id} onChange={(e) => { const c = clientes.find((x) => String(x.id) === e.target.value); setDatos({ ...datos, cliente_id: e.target.value, id_solicitud: c && /^\d+$/.test(c.codigo || "") && !(datos.id_solicitud || "").startsWith(c.codigo) ? c.codigo : datos.id_solicitud }); }}>
              <option value="">{venta.cliente_id ? "—" : `Sin asociar (${venta.cliente_nombre || "sin nombre"})`}</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ""}{c.nombre}</option>)}
            </select>
          </div>
          <div className="field">
            <label>ID del cliente o solicitud</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={datos.id_solicitud} onChange={(e) => setDatos({ ...datos, id_solicitud: e.target.value })} />
              {cambioDatos && <button className="btn btn-success btn-sm" onClick={guardarDatos}>Guardar</button>}
            </div>
          </div>
        </div>
      )}
      <HistorialVenta venta={venta} />
      <RespaldoVenta venta={venta} puede={puedeOperar} notify={notify} onCambio={onCambio} />
      {(modo !== "operativo" || venta.facturas?.length > 0) && <PanelFacturas venta={venta} puedeVender={editaDatos || (puedeVender && modo === "finanzas" && esAdmin)} notify={notify} onCambio={onCambio} />}
      <div className="table-wrap">
        <table className="table table-compacta">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th>{verCompras && <th>Costo</th>}{verCompras && <th>Proveedor</th>}<th>Total</th>{puedeCambiar && <th></th>}</tr></thead>
          <tbody>
            {venta.items.map((i, k) => (
              <tr key={k}>
                <td>{i.complemento_de ? "↳ " : ""}{i.descripcion_cliente || i.nombre}{i.complemento_de && <div className="mini" style={{ color: "var(--accent)" }}>complemento de: {i.complemento_de} (sin precio, se compra aparte)</div>}{i.cambio && <div className="mini" title={`Cambiado el ${i.cambio.fecha}`}>antes: {i.cambio.antes}</div>}</td>
                <td className="mini">{i.cantidad} {i.unidad}</td>
                <td className="price-cell">{fmt(i.precio)}</td>
                {verCompras && <td className="price-cell compra">{fmt(i.costo)}</td>}
                {verCompras && <td className="mini">{i.proveedor || "—"}</td>}
                <td className="price-cell">{fmt(i.precio * i.cantidad)}</td>
                {puedeCambiar && <td><button className="link mini" title="El cliente cambió de opinión: cambiar este producto (queda en el historial)" onClick={() => setCambiar(k)}>cambiar</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totales subtotal={venta.subtotal} iva={venta.iva} total={venta.total} />
      {esAdmin && verCobros && r && (
        <div className="panel">
          <div className="panel-titulo">Utilidad de la venta</div>
          <div className="resumen-utilidad">
            <div><span className="stat-label">Margen bruto</span><strong>{fmt(r.margen)}</strong><span className="mini">{r.margen_pct}% del neto</span></div>
            <div><span className="stat-label">Gastos</span><strong>−{fmt(r.gastos)}</strong><span className="mini">{venta.gastos.length} registrados</span></div>
            <div><span className="stat-label">Utilidad</span><strong style={{ color: r.utilidad >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(r.utilidad)}</strong><span className="mini">con costo cotizado</span></div>
            {r.utilidad_real !== null && <div><span className="stat-label">Utilidad real</span><strong>{fmt(r.utilidad_real)}</strong><span className="mini">con lo comprado ({fmt(r.compras_real)})</span></div>}
          </div>
          {venta.gastos.length > 0 && (
            <table className="table table-compacta">
              <tbody>{venta.gastos.map((g) => (
                <tr key={g.id}><td className="mini">{fecha(g.fecha)}</td><td>{TIPOS_GASTO[g.tipo] || g.tipo}</td><td className="mini">{g.descripcion || ""}</td><td className="price-cell">{fmt(g.monto)}</td></tr>
              ))}</tbody>
            </table>
          )}
          <GastoRapido ventaId={venta.id} notify={notify} onCreado={onCambio} />
          {venta.ordenes.length > 0 && (
            <div className="mini">Órdenes de compra: {venta.ordenes.map((o) => (
              <button key={o.id} className="link" onClick={() => irACompra?.(o.id)}>{o.numero} {o.proveedor_nombre} ({o.estado})</button>
            ))}</div>
          )}
        </div>
      )}
      {verCompras && !verCobros && venta.ordenes?.length > 0 && (
        <div className="mini">Órdenes de compra: {venta.ordenes.map((o) => (
          <button key={o.id} className="link" onClick={() => irACompra?.(o.id)}>{o.numero} {o.proveedor_nombre} ({o.estado})</button>
        ))}</div>
      )}
      {verCobros && <PagosPanel
        key={venta.monto_pagado}
        doc={venta}
        tipo="cobro"
        onRegistrar={(body) => accion(() => api(`/ventas/${venta.id}/cobros`, { method: "POST", body }), "✓ Cobro registrado")}
        onEliminar={esAdmin ? async (p) => (await confirmar("¿Eliminar este cobro?", { titulo: "Eliminar cobro", boton: "Eliminar", peligro: true })) && accion(() => api(`/pagos/${p.id}`, { method: "DELETE" }), "Cobro eliminado") : null}
      />}
      {cambiar != null && <CambiarProducto venta={venta} indice={cambiar} verCompras={verCompras} notify={notify} onClose={() => setCambiar(null)} onHecho={() => { setCambiar(null); onCambio(); }} />}
      {cuadro && <CuadroCompra ventaId={venta.id} esAdmin={esAdmin} notify={notify} irACompra={irACompra} onClose={() => { setCuadro(false); onCambio(); }} />}
    </Modal>
  );
}

// Agregar un gasto (flete, combustible, comisión) asociado a la venta
function GastoRapido({ ventaId, notify, onCreado }) {
  const [form, setForm] = useState({ tipo: "flete", monto: "", descripcion: "" });
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    setEnviando(true);
    try {
      await api("/gastos", { method: "POST", body: { ...form, monto: Number(form.monto), venta_id: ventaId } });
      notify("✓ Gasto agregado");
      setForm({ tipo: "flete", monto: "", descripcion: "" });
      onCreado();
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  return (
    <div className="pago-form">
      <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
        {Object.entries(TIPOS_GASTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input type="number" placeholder="Monto" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
      <input placeholder="Detalle (opcional)" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
      <button className="btn btn-ghost btn-sm" disabled={enviando || !(Number(form.monto) > 0)} onClick={guardar}>+ Gasto</button>
    </div>
  );
}

// Anular una venta: la misma ventana en Comercial y Operativo. Muestra lo que tiene la venta, qué impide anularla
// y qué pasará; el motivo es obligatorio y queda registrado con quién la anuló.
function AnularVenta({ venta, notify, onClose, onHecho }) {
  const [r, setR] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { api(`/ventas/${venta.id}/anulacion`).then(setR).catch((e) => { notify(e.message, "danger"); onClose(); }); }, [venta.id, notify, onClose]);
  const confirmar = async () => {
    setEnviando(true);
    try {
      await api(`/ventas/${venta.id}/anular`, { method: "POST", body: { motivo } });
      notify(`Venta ${venta.numero} anulada`);
      onHecho();
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  return (
    <Modal titulo={`// Anular la venta ${venta.numero}`} onClose={onClose} ancho={620}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-danger" disabled={!r?.puede || !motivo.trim() || enviando} onClick={confirmar}>{enviando ? "Anulando..." : "Anular venta"}</button>
      </>}>
      {!r ? <div className="cot-empty"><span className="spinner"></span>Revisando la venta...</div> : <>
        <div className="mini" style={{ marginBottom: 8 }}>{venta.cliente_nombre || "Sin cliente"} · {fmt(venta.total)} con IVA{venta.orden_compra_cliente ? ` · OC ${venta.orden_compra_cliente}` : ""}</div>
        {r.bloqueos.length > 0 ? (
          <div className="aviso" style={{ color: "var(--danger)", borderColor: "rgba(184,56,44,.35)", background: "rgba(184,56,44,.06)" }}>
            <strong>Todavía no se puede anular:</strong>
            <ul style={{ margin: "6px 0 0 18px" }}>{r.bloqueos.map((b) => <li key={b.que} style={{ marginBottom: 4 }}>{b.que}<div className="mini">→ {b.donde}</div></li>)}</ul>
          </div>
        ) : <div className="aviso" style={{ color: "var(--success)", borderColor: "rgba(42,127,80,.35)", background: "rgba(42,127,80,.06)" }}>Se puede anular: no tiene facturas, cobros ni compras recibidas.</div>}
        <div className="panel-titulo" style={{ marginTop: 10 }}>Qué pasará</div>
        <ul style={{ margin: "0 0 10px 18px", fontSize: 13 }}>
          {r.compras_pedidas.length > 0 && <li>Se anulan {r.compras_pedidas.length} compra(s) pedida(s) sin recibir: {r.compras_pedidas.map((o) => `${o.numero} (${o.proveedor})`).join(", ")}. Avisa al proveedor.</li>}
          <li>La cotización vuelve a <strong>Enviadas</strong> como abierta.</li>
          <li>Operativo deja de verla en sus tareas.</li>
          <li>Queda registrado quién la anuló, cuándo y por qué.</li>
        </ul>
        <div className="field">
          <label>Motivo (obligatorio)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: el cliente anuló la OC / error al registrar" disabled={!r.puede} />
        </div>
      </>}
    </Modal>
  );
}
