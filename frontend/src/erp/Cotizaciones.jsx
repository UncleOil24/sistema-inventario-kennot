import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, Totales, confirmar, pedirTexto, modoPedido } from "./ui";
import { conConfirmacion } from "./Recorrido";
import { api, fmt, fecha, descargar, cargarProductos, hoyISO, idCot, nombreCot, subirArchivo } from "./lib";

// Pestañas: En ejecución (borrador) · Esperando proveedor · Enviadas (con sus resultados)
const SUB_ENVIADAS = [["cotizacion", "Sin respuesta"], ["aceptada", "Aceptadas"], ["rechazada", "Rechazadas"], ["vencida", "Vencidas"], ["enviadas", "Todas"]];
const TITULO_TAB = { borrador: "En ejecución", espera_proveedor: "Esperando cotización de proveedor", enviadas: "Enviadas" };

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${String(a).slice(0, 10)}T12:00:00`)) / 864e5);

export default function Cotizaciones({ esAdmin, esGerencia, notify, onEditar, onVenta, verVenta, tab = "enviadas" }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState(tab === "enviadas" ? "cotizacion" : tab);
  const [proveedorDe, setProveedorDe] = useState(null); // subir cotización del proveedor
  const [seguimiento, setSeguimiento] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [aceptar, setAceptar] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.append("estado", estado);
      if (busqueda) p.append("busqueda", busqueda);
      if (empresa) p.append("empresa", empresa);
      setLista(await api(`/cotizaciones?${p}`));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [estado, busqueda, empresa, notify]);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  const accion = async (fn, ok) => { try { await fn(); notify(ok); cargar(); } catch (e) { notify(e.message, "danger"); } };
  const nombreArchivo = (c, ext) => `${idCot(c)}${c.anterior ? "_anterior" : ""}-${c.cliente || "cliente"}.${ext}`;
  const excel = (c) => descargar(`/cotizaciones/${c.id}/excel`, nombreArchivo(c, "xlsx")).catch((e) => notify(e.message, "danger"));
  const pdf = (c) => descargar(`/cotizaciones/${c.id}/pdf`, nombreArchivo(c, "pdf")).catch((e) => notify(e.message, "danger"));
  const rechazar = async (c) => {
    const motivo = await pedirTexto(`¿Por qué se rechazó la ${nombreCot(c)}?`, { titulo: "Cotización rechazada", placeholder: "precio, plazo, se compró a otro...", boton: "Marcar rechazada" });
    if (motivo !== null) accion(() => api(`/cotizaciones/${c.id}/estado`, { method: "POST", body: { estado: "rechazada", motivo } }), "Cotización marcada como rechazada");
  };
  const reabrir = (c) => accion(() => api(`/cotizaciones/${c.id}/estado`, { method: "POST", body: { estado: "cotizacion" } }), "Cotización reabierta");
  const pedido = async (c) => {
    const modo = await modoPedido(c.items);
    if (!modo) return;
    descargar(`/cotizaciones/${c.id}/pedido-proveedor?modo=${modo}`, `Pedido_cotizacion_${idCot(c)}.xlsx`).catch((e) => notify(e.message, "danger"));
  };
  const vencer = (c) => accion(() => api(`/cotizaciones/${c.id}/estado`, { method: "POST", body: { estado: "vencida" } }), "Cotización marcada como vencida");
  const eliminar = async (c) => (await confirmar(`¿Eliminar la ${nombreCot(c)}?\nEs mejor marcarla rechazada o vencida para no perder el historial.`, { titulo: "Eliminar cotización", boton: "Eliminar", peligro: true }))
    && accion(() => api(`/cotizaciones/${c.id}`, { method: "DELETE" }), "Cotización eliminada");

  // Carga la cotización en el cotizador (conserva precios cotizados)
  const editar = async (c) => {
    try {
      const productos = await cargarProductos();
      const mapa = new Map(productos.map((p) => [p.id, p]));
      const items = c.items.map((i) => {
        const p = mapa.get(i.producto_id) || {};
        return {
          producto_id: i.producto_id, codigo: i.codigo ?? p.codigo, nombre: i.nombre, unidad: i.unidad,
          cantidad: i.cantidad, precio: i.precio, auto: false,
          convenio: Number(p.precio_convenio) || 0, particular: Number(p.precio_particular) || 0,
          costo: i.costo, proveedor: i.proveedor, descripcion_cliente: i.descripcion_cliente, grupo: i.grupo || "",
          caso: i.caso || (i.producto_id ? "mismo" : "nuevo"), clave: i.clave, nota_interna: i.nota_interna || "",
        };
      });
      onEditar({
        id: c.id, numero: c.numero, empresa: c.empresa || "kenott", empresa_original: c.empresa || "kenott", cliente_id: c.cliente_id || "", tipo_precio: c.tipo_precio,
        nombre_cotizacion: c.nombre_cotizacion || "", validez_dias: c.validez_dias || 30, notas: c.notas || "", archivo_cliente: c.archivo_cliente || "", items,
        id_solicitud: c.id_solicitud || "", presupuesto: c.presupuesto || null, lugar_entrega: c.lugar_entrega || "", plazo_entrega: c.plazo_entrega || "", cliente_nombre_doc: c.cliente || "", anterior: c.anterior, creado_por: c.creado_por || "", estado: c.estado,
      });
    } catch (e) { notify(e.message, "danger"); }
  };

  return (
    <>
      <div className="toolbar">
        <div className="mini" style={{ fontWeight: 600, color: "var(--text)" }}>{TITULO_TAB[tab]} · {lista.length} · {fmt(lista.reduce((s, c) => s + Number(c.total), 0))} con IVA</div>
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N°, ID del cliente o solicitud, cliente o nombre..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="chips">
          {[["", "Ambas"], ["kenott", "Kenott"], ["tactics", "Tactics"]].map(([v, t]) => <button key={`e${v}`} className={`chip ${empresa === v ? "activo" : ""}`} onClick={() => setEmpresa(v)}>{t}</button>)}
        </div>
        {tab === "enviadas" && (
          <div className="chips">
            {SUB_ENVIADAS.map(([v, t]) => <button key={v} className={`chip ${estado === v ? "activo" : ""}`} onClick={() => setEstado(v)}>{t}</button>)}
          </div>
        )}
      </div>

      {loading ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div>
        : lista.length === 0 ? <div className="cot-empty">{tab === "borrador" ? "// no hay cotizaciones en ejecución" : tab === "espera_proveedor" ? "// ninguna cotización esperando proveedor" : "// sin cotizaciones"}</div>
        : (
          <div className="hist-list">
            {lista.map((c) => (
              <div key={c.id} className="hist-card">
                <div className="hist-info">
                  <div className="hist-nombre">{nombreCot(c)} · {c.nombre_cotizacion || "Sin nombre"}</div>
                  <div className="hist-meta">
                    {c.id_solicitud
                      ? <span className="id-solicitud" title="ID del cliente o de la solicitud de Mercado Público">ID {c.id_solicitud}</span>
                      : <span className="mini" style={{ color: "var(--warn)" }} title="Edítala para agregar el ID del cliente o de la solicitud">sin ID</span>}
                    {c.creado_por && <span title="Quién la hizo">por {c.creado_por}</span>}
                    <Estado valor={c.empresa || "kenott"} />
                    <span>{c.cliente || "Sin cliente"}</span>
                    <span>{fecha(c.fecha || c.createdAt)}</span>
                    {c.estado === "cotizacion" && c.fecha_validez && <span>válida hasta {fecha(c.fecha_validez)}</span>}
                    {c.estado === "cotizacion" && <SeguimientoInfo c={c} />}
                    <span>{c.items?.length || 0} productos</span>
                    <Estado valor={c.tipo_precio} />
                    <Estado valor={c.estado} />
                    {c.motivo_estado && c.estado !== "cotizacion" && <span>{c.motivo_estado}</span>}
                    {esAdmin && c.margen !== undefined && <span>margen {fmt(c.margen)} ({c.margen_pct}%){c.lineas_sin_costo ? ` · ${c.lineas_sin_costo} sin costo` : ""}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <div className="hist-total">{fmt(c.total)}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAbierta(c)}>Ver</button>
                    {c.estado === "borrador" && <>
                      <button className="btn btn-primary btn-sm" onClick={() => editar(c)}>Continuar</button>
                      <button className="btn btn-ghost btn-sm" title="Excel con el detalle de materiales sin valores (hoja General y una por especialidad), para enviar a cotizar" onClick={() => pedido(c)}>↓ Pedido a proveedor</button>
                    </>}
                    {c.estado === "espera_proveedor" && <>
                      <button className="btn btn-primary btn-sm" onClick={() => setProveedorDe(c)}>Subir cotización del proveedor</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => pedido(c)}>↓ Pedido a proveedor</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => editar(c)}>Continuar sin esperar</button>
                    </>}
                    {!["borrador", "espera_proveedor"].includes(c.estado) && <>
                      <button className="btn btn-ghost btn-sm" onClick={() => pdf(c)}>↓ PDF</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => excel(c)}>↓ Excel</button>
                    </>}
                    {esAdmin && <button className="btn btn-ghost btn-sm" title="Hoja de referencia interna con costos y productos usados: no se envía al cliente" onClick={() => descargar(`/cotizaciones/${c.id}/interna`, `INTERNA_${idCot(c)}.xlsx`).catch((e) => notify(e.message, "danger"))}>↓ Interna</button>}
                    {c.estado === "cotizacion" && <button className="btn btn-ghost btn-sm" onClick={() => editar(c)}>Editar</button>}
                    {c.estado === "cotizacion" && <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSeguimiento(c)}>☎ Seguimiento</button>
                      <button className="btn btn-success btn-sm" onClick={() => setAceptar(c)}>✓ Aceptada → Venta</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => rechazar(c)}>Rechazada</button>
                    </>}
                    {["rechazada", "vencida"].includes(c.estado) && <button className="btn btn-ghost btn-sm" onClick={() => reabrir(c)}>Reabrir</button>}
                    {c.estado === "aceptada" && c.venta_id && <button className="btn btn-ghost btn-sm" onClick={() => verVenta(c.venta_id)}>Ver venta</button>}
                    {esGerencia && c.estado !== "aceptada" && <button className="btn btn-danger btn-sm" onClick={() => eliminar(c)}>✕</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {abierta && <DetalleCotizacion cot={abierta} esAdmin={esAdmin} onClose={() => setAbierta(null)} onVencer={() => { vencer(abierta); setAbierta(null); }} />}
      {seguimiento && <Seguimiento cot={seguimiento} notify={notify} onClose={() => setSeguimiento(null)} onHecho={() => { setSeguimiento(null); cargar(); }} />}
      {proveedorDe && <SubirProveedor cot={proveedorDe} notify={notify} onClose={() => setProveedorDe(null)}
        onHecho={(cot) => { setProveedorDe(null); cargar(); editar(cot); }} />}
      {aceptar && <AceptarCotizacion cot={aceptar} notify={notify} onClose={() => setAceptar(null)}
        onHecho={(venta) => { setAceptar(null); cargar(); onVenta(venta); }} />}
    </>
  );
}

function DetalleCotizacion({ cot, esAdmin, onClose, onVencer }) {
  return (
    <Modal titulo={`// ${nombreCot(cot)}`} onClose={onClose} ancho={820}
      footer={<>
        {cot.estado === "cotizacion" && <button className="btn btn-ghost" onClick={onVencer}>Marcar vencida</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="hist-meta">
        <span>{cot.cliente || "Sin cliente"}</span>{cot.id_solicitud && <span className="id-solicitud">ID {cot.id_solicitud}</span>}<span>{fecha(cot.fecha || cot.createdAt)}</span>
        {cot.plazo_entrega && <span>Entrega: {cot.plazo_entrega}</span>}
        <span>Validez {cot.validez_dias} días{cot.fecha_validez ? ` (hasta ${fecha(cot.fecha_validez)})` : ""}</span>
        {cot.creado_por && <span>Por {cot.creado_por}</span>}
        {cot.archivo_cliente && <span>Lista del cliente: {cot.archivo_cliente}</span>}
        <Estado valor={cot.tipo_precio} /><Estado valor={cot.estado} />
      </div>
      <div className="table-wrap">
        <table className="table table-compacta">
          <thead><tr><th>N°</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th>{esAdmin && <th>Costo</th>}{esAdmin && <th>Proveedor</th>}{esAdmin && <th>Margen</th>}</tr></thead>
          <tbody>
            {cot.items.map((i, k) => {
              const m = (Number(i.precio) - Number(i.costo || 0)) * Number(i.cantidad);
              return (
                <tr key={k} className={i.caso === "nuevo" || !i.producto_id ? "fila-nuevo" : i.caso === "similar" ? "fila-similar" : !(Number(i.precio) > 0) ? "fila-alerta" : ""}>
                  <td className="id-cell">{i.codigo ?? ""}</td>
                  <td>{i.descripcion_cliente || i.nombre}
                    <div className="mini">{!i.producto_id ? "No está en catálogo" : `${i.caso === "similar" ? "Similar" : "Nuestro"}: ${i.nombre}`}{esAdmin && i.nota_interna ? ` · ${i.nota_interna}` : ""}</div></td>
                  <td className="mini">{i.cantidad} {i.unidad}</td>
                  <td className="price-cell">{fmt(i.precio)}</td>
                  <td className="price-cell">{fmt(i.precio * i.cantidad)}</td>
                  {esAdmin && <td className="price-cell compra">{i.costo !== undefined ? fmt(i.costo) : "—"}</td>}
                  {esAdmin && <td className="mini">{i.proveedor || "—"}</td>}
                  {esAdmin && <td className="mini">{i.costo !== undefined ? fmt(m) : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Totales subtotal={cot.subtotal} iva={cot.iva} total={cot.total} />
      {esAdmin && <div className="mini">Margen interno (no se imprime): <strong style={{ color: "var(--text)" }}>{fmt(cot.margen)}</strong> ({cot.margen_pct}% sobre el neto)</div>}
    </Modal>
  );
}

export function AceptarCotizacion({ cot, notify, onClose, onHecho }) {
  const [form, setForm] = useState({ orden_compra_cliente: "", dias_credito: 30, pagada_al_contado: false, medio_pago: "transferencia" });
  const [cliente, setCliente] = useState(null);
  // El plazo de pago viene de la ficha del cliente
  useEffect(() => {
    if (!cot.cliente_id) return;
    api("/clientes").then((l) => {
      const c = l.find((x) => x.id === cot.cliente_id);
      if (c) { setCliente(c); setForm((f) => ({ ...f, dias_credito: c.plazo_pago_dias ?? 30 })); }
    }).catch(() => {});
  }, [cot.cliente_id]);
  const [enviando, setEnviando] = useState(false);
  const confirmar = async () => {
    setEnviando(true);
    try {
      const venta = await conConfirmacion(`/ventas/desde-cotizacion/${cot.id}`, {
        orden_compra_cliente: form.orden_compra_cliente || null,
        ...(form.pagada_al_contado ? { pagada_al_contado: true, medio_pago: form.medio_pago } : { dias_credito: Number(form.dias_credito) || 0 }),
      });
      notify(`✓ Venta ${venta.numero} creada — Operativo la verá para aceptarla y comprar`);
      onHecho(venta);
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  return (
    <Modal titulo={`// Cliente aceptó la ${nombreCot(cot)}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-success" disabled={enviando} onClick={confirmar}>{enviando ? "Creando..." : "Confirmar venta"}</button>
      </>}>
      <div className="mini">{cot.cliente || "Sin cliente"} · {fmt(cot.total)} con IVA. La venta copia los mismos precios y costos de la cotización.</div>
      <div className="field">
        <label>N° orden de compra del cliente</label>
        <input value={form.orden_compra_cliente} onChange={(e) => setForm({ ...form, orden_compra_cliente: e.target.value })} placeholder="Ej: 2401-55-SE26 (Mercado Público)" />
      </div>
      <label className="check">
        <input type="checkbox" checked={form.pagada_al_contado} onChange={(e) => setForm({ ...form, pagada_al_contado: e.target.checked })} />
        Pagada al contado
      </label>
      {form.pagada_al_contado ? (
        <div className="field"><label>Medio de pago</label>
          <select value={form.medio_pago} onChange={(e) => setForm({ ...form, medio_pago: e.target.value })}>
            {["transferencia", "efectivo", "tarjeta", "cheque"].map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
      ) : (
        <div className="field"><label>Plazo de pago (días){cliente ? ` · ficha: ${cliente.plazo_pago_dias ?? 30}${cliente.base_vencimiento === "recepcion" ? " desde recepción" : ""}` : ""}</label>
          <input type="number" min="0" value={form.dias_credito} onChange={(e) => setForm({ ...form, dias_credito: e.target.value })} />
        </div>
      )}
    </Modal>
  );
}

// Cuándo se habló con el cliente y cuándo toca volver a llamar
function SeguimientoInfo({ c }) {
  const hoy = hoyISO();
  const base = c.ultimo_contacto || c.fecha;
  const dias = base ? diasEntre(base, hoy) : 0;
  const toca = c.proximo_contacto && c.proximo_contacto <= hoy;
  return (
    <span className={toca ? "antiguo" : ""}>
      {c.ultimo_contacto ? `último contacto hace ${dias} día(s)` : `enviada hace ${dias} día(s), sin contacto`}
      {c.proximo_contacto ? ` · llamar ${c.proximo_contacto <= hoy ? "hoy" : `el ${fecha(c.proximo_contacto)}`}` : ""}
    </span>
  );
}

function Seguimiento({ cot, notify, onClose, onHecho }) {
  const [nota, setNota] = useState("");
  const [dias, setDias] = useState(5);
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    setEnviando(true);
    try {
      await api(`/cotizaciones/${cot.id}/seguimiento`, { method: "POST", body: { nota, dias: Number(dias) } });
      notify("✓ Seguimiento registrado");
      onHecho();
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  const historial = [...(cot.seguimientos || [])].reverse();
  return (
    <Modal titulo={`// Seguimiento ${nombreCot(cot)}`} onClose={onClose} ancho={620}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={enviando} onClick={guardar}>{enviando ? "Guardando..." : "Registrar contacto"}</button>
      </>}>
      <div className="mini">{cot.cliente || "Sin cliente"} · {cot.nombre_cotizacion} · {fmt(cot.total)} · válida hasta {fecha(cot.fecha_validez)}</div>
      <div className="field">
        <label>¿Qué dijo el cliente?</label>
        <textarea className="textarea" rows={3} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: La está revisando la directora, responden el lunes" />
      </div>
      <div className="field">
        <label>Volver a llamar en</label>
        <select value={dias} onChange={(e) => setDias(e.target.value)}>
          {[[1, "1 día"], [2, "2 días"], [3, "3 días"], [5, "5 días"], [7, "1 semana"], [14, "2 semanas"], [0, "No volver a llamar"]].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>
      {historial.length > 0 && (
        <div className="panel">
          <div className="panel-titulo">Contactos anteriores</div>
          {historial.map((h, k) => (
            <div key={k} className="mini"><strong style={{ color: "var(--text)" }}>{new Date(h.fecha).toLocaleDateString("es-CL")}</strong> · {h.usuario}: {h.nota || "(sin nota)"}{h.proximo ? ` · llamar el ${fecha(h.proximo)}` : ""}</div>
          ))}
        </div>
      )}
      <div className="mini">Si el cliente ya decidió, cierra la ventana y usa "Aceptada → Venta" o "Rechazada".</div>
    </Modal>
  );
}

// Subir la cotización del proveedor: Claude la lee, propone el precio de cada línea, se revisa y se aplica.
// Los precios quedan también en el catálogo (historial del proveedor); las líneas que no estaban se crean en POR CLASIFICAR.
function SubirProveedor({ cot, notify, onClose, onHecho }) {
  const [leyendo, setLeyendo] = useState(false);
  const [r, setR] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [prov, setProv] = useState({ proveedor: "", documento: "" });
  const [guardando, setGuardando] = useState(false);
  const leer = async (archivo) => {
    if (!archivo) return;
    setLeyendo(true);
    try {
      const d = await subirArchivo(`/cotizaciones/${cot.id}/leer-proveedor`, archivo);
      setR(d);
      setProv({ proveedor: d.encabezado.proveedor || "", documento: d.encabezado.numero_documento || "", fecha: d.encabezado.fecha || "" });
      setLineas(d.propuesta.map((p) => ({ ...p, usar: !!p.proveedor_linea, precio: p.proveedor_linea?.precio_neto || "" })));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };
  const aplicar = async () => {
    setGuardando(true);
    try {
      const sel = lineas.filter((l) => l.usar && Number(l.precio) > 0);
      const nueva = await api(`/cotizaciones/${cot.id}/aplicar-proveedor`, { method: "POST", body: {
        ...prov, lineas: sel.map((l) => ({ idx: l.idx, precio: Number(l.precio), descripcion_proveedor: l.proveedor_linea?.descripcion || null, marca: l.proveedor_linea?.marca || null })),
      } });
      notify(`✓ ${sel.length} precio(s) aplicados y guardados en el catálogo`);
      onHecho(nueva);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  const usadas = lineas.filter((l) => l.usar && Number(l.precio) > 0).length;
  return (
    <Modal titulo={`// Cotización del proveedor para ${nombreCot(cot)}`} onClose={onClose} ancho={1000}
      footer={r && <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || !usadas || !prov.proveedor.trim()} onClick={aplicar}>{guardando ? "Aplicando..." : `Aplicar ${usadas} precio(s) y seguir cotizando`}</button>
      </>}>
      {!r && (
        <div className="field">
          <label>Archivo de la cotización del proveedor (PDF, Excel o foto)</label>
          <input type="file" accept=".pdf,.xlsx,.xls,.csv,image/*" disabled={leyendo} onChange={(e) => leer(e.target.files[0])} />
          {leyendo && <div className="mini"><span className="spinner"></span> Leyendo y calzando con las líneas de la cotización...</div>}
          <div className="mini">Se leen los precios netos y se proponen en la línea que corresponde. Revisa antes de aplicar.</div>
        </div>
      )}
      {r && <>
        <div className="fields-row">
          <div className="field"><label>Proveedor</label><input value={prov.proveedor} onChange={(e) => setProv({ ...prov, proveedor: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label>N° cotización / factura</label><input value={prov.documento} onChange={(e) => setProv({ ...prov, documento: e.target.value })} /></div>
        </div>
        {r.control?.cuadra === false && <div className="aviso">La suma de las líneas no cuadra con el total del documento: revisa los precios.</div>}
        <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
          <table className="table table-compacta">
            <thead><tr><th></th><th>Lo que pidió el cliente</th><th>Cant.</th><th>Costo actual</th><th>Lo que cotizó el proveedor</th><th>Precio neto</th></tr></thead>
            <tbody>{lineas.map((l, k) => (
              <tr key={l.idx} style={{ opacity: l.usar ? 1 : 0.55 }}>
                <td><input type="checkbox" checked={l.usar} onChange={(e) => setLineas(lineas.map((x, j) => (j === k ? { ...x, usar: e.target.checked } : x)))} /></td>
                <td>{l.descripcion}{l.producto && <div className="mini">{l.producto}</div>}</td>
                <td className="mini">{l.cantidad} {l.unidad}</td>
                <td className="mini">{l.costo_actual ? fmt(l.costo_actual) : "sin costo"}</td>
                <td className="mini">{l.proveedor_linea ? <>{l.proveedor_linea.descripcion}{l.proveedor_linea.calce !== "exacto" && <div style={{ color: "var(--warn)" }}>{l.proveedor_linea.calce}{l.proveedor_linea.nota ? `: ${l.proveedor_linea.nota}` : ""}</div>}</> : "— no cotizado —"}</td>
                <td><input type="number" min="0" style={{ width: 110 }} value={l.precio} onChange={(e) => setLineas(lineas.map((x, j) => (j === k ? { ...x, precio: e.target.value, usar: Number(e.target.value) > 0 } : x)))} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {r.sin_usar?.length > 0 && <div className="mini" style={{ marginTop: 6 }}>Del documento no se usaron: {r.sin_usar.map((x) => `${x.descripcion} (${fmt(x.precio_neto)})`).join(" · ")}</div>}
      </>}
    </Modal>
  );
}
