import { useState, useEffect, useCallback } from "react";
import { Modal } from "./ui";
import DocumentoProveedor from "./DocumentoProveedor";
import { api, fmt, fecha, hoyISO, invalidarProductos } from "./lib";

const UNIDADES = ["UNIDAD", "METRO", "KG", "CAJA", "ROLLO", "M3", "M2", "BOLSA", "SACO", "PACK", "PLANCHA", "JUEGO", "LITRO", "GALÓN"];
const POR_PAGINA = 150;
const FILTROS = [
  ["", "Todos"],
  ["aviso", "Con aviso en REVISAR"],
  ["sin_precio", "Sin precio (falta cotizar)"],
  ["sin_confirmar", "Con precio sin confirmar"],
  ["confirmados", "Confirmados"],
];

export default function Catalogo({ esAdmin, notify, enCotizacion, onCotizar, proveedores }) {
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("Todas");
  const [revision, setRevision] = useState("");
  const [categorias, setCategorias] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [editar, setEditar] = useState(null);
  const [precios, setPrecios] = useState(null);
  const [documento, setDocumento] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (busqueda) p.append("busqueda", busqueda);
      if (categoria !== "Todas") p.append("categoria", categoria);
      if (revision) p.append("revision", revision);
      setProductos(await api(`/productos?${p}`));
      setMostrar(POR_PAGINA);
    } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [busqueda, categoria, revision, notify]);

  useEffect(() => { const t = setTimeout(cargar, 300); return () => clearTimeout(t); }, [cargar]);

  const cargarCategorias = useCallback(() => {
    api("/productos/categorias").then(setCategorias).catch(() => {});
    api("/productos/resumen").then(setResumen).catch(() => {});
  }, []);
  useEffect(() => { cargarCategorias(); }, [cargarCategorias]);

  // Tras cambiar un precio: refresca lista, resumen y el catálogo en memoria del cotizador
  const refrescar = () => { invalidarProductos(); cargar(); cargarCategorias(); };

  const tot = (resumen || []).reduce((a, r) => ({
    items: a.items + r.items, con_precio: a.con_precio + r.con_precio, sin_precio: a.sin_precio + r.sin_precio,
    confirmados: a.confirmados + r.confirmados, con_aviso: a.con_aviso + r.con_aviso,
  }), { items: 0, con_precio: 0, sin_precio: 0, confirmados: 0, con_aviso: 0 });

  const cols = esAdmin ? 11 : 7;

  return (
    <>
      <div className="stats">
        <div className="stat-card clickable" onClick={() => setRevision("")}><div className="stat-label">Productos</div><div className="stat-value">{tot.items.toLocaleString("es-CL")}</div></div>
        <div className="stat-card clickable" onClick={() => setRevision("sin_confirmar")}><div className="stat-label">Con precio</div><div className="stat-value">{tot.con_precio.toLocaleString("es-CL")}</div><div className="mini">{tot.confirmados} confirmados</div></div>
        <div className="stat-card clickable" onClick={() => setRevision("sin_precio")}><div className="stat-label">Sin precio</div><div className="stat-value" style={{ color: tot.sin_precio ? "var(--warn)" : "var(--success)" }}>{tot.sin_precio.toLocaleString("es-CL")}</div><div className="mini">falta cotizar</div></div>
        <div className="stat-card clickable" onClick={() => setRevision("aviso")}><div className="stat-label">Por revisar</div><div className="stat-value" style={{ color: tot.con_aviso ? "var(--danger)" : "var(--success)" }}>{tot.con_aviso.toLocaleString("es-CL")}</div><div className="mini">avisos en REVISAR</div></div>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder='Palabras en cualquier orden, con o sin tilde. Ej: "tuberia pvc 20", "pino 2x4"' value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select className="filter-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="Todas">Todas las categorías</option>
          {categorias.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.cantidad})</option>)}
        </select>
        <select className="filter-select" value={revision} onChange={(e) => setRevision(e.target.value)}>
          {FILTROS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {esAdmin && <button className="btn btn-ghost" onClick={() => setDocumento(true)} title="Cotización o factura de proveedor (PDF o foto)">⇪ Documento proveedor</button>}
        <button className="btn btn-primary" onClick={() => setEditar({ nombre: "", categoria: categoria !== "Todas" ? categoria : (categorias[0]?.categoria || ""), unidad: "UNIDAD" })}>+ Nuevo producto</button>
      </div>

      {(revision === "sin_precio" || revision === "aviso") && resumen && (
        <div className="panel">
          <div className="panel-titulo">{revision === "sin_precio" ? "Productos sin precio por categoría (para pedir cotización)" : "Avisos por categoría"}</div>
          <div className="chips">
            {resumen.filter((r) => (revision === "sin_precio" ? r.sin_precio : r.con_aviso) > 0).map((r) => (
              <button key={r.categoria} className={`chip ${categoria === r.categoria ? "activo" : ""}`} onClick={() => setCategoria(categoria === r.categoria ? "Todas" : r.categoria)}>
                {r.categoria} <strong>{revision === "sin_precio" ? r.sin_precio : r.con_aviso}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table table-compacta">
          <thead>
            <tr>
              <th>N°</th><th className="col-desc">Descripción</th><th>Unidad</th>
              {esAdmin && <th>P. compra</th>}
              {esAdmin && <th>Proveedor</th>}
              <th>Convenio</th><th>Particular</th>
              {esAdmin && <th>Opción 2</th>}
              {esAdmin && <th>Opción 3</th>}
              {esAdmin && <th>Revisar</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={cols}><span className="spinner"></span>Cargando...</td></tr>
              : productos.length === 0 ? <tr className="empty-row"><td colSpan={cols}>// sin resultados</td></tr>
              : productos.slice(0, mostrar).map((p) => {
                const sinPrecio = !(Number(p.precio_convenio) > 0);
                return (
                  <tr key={p.id}>
                    <td className="id-cell">{p.codigo ?? "—"}</td>
                    <td>
                      {p.nombre}
                      <div className="mini">{p.categoria}{esAdmin && p.fecha_precio ? ` · act. ${fecha(p.fecha_precio)}` : ""}</div>
                    </td>
                    <td className="mini">{p.unidad}</td>
                    {esAdmin && <td className="price-cell compra">{sinPrecio ? "—" : fmt(p.precio_compra)}{p.confirmado && <span className="ok-confirm" title="Precio confirmado">✓</span>}</td>}
                    {esAdmin && <td className="mini">{p.proveedor || "—"}</td>}
                    <td className="price-cell">{sinPrecio ? <span className="mini">sin precio</span> : fmt(p.precio_convenio)}</td>
                    <td className="price-cell">{sinPrecio ? "" : fmt(p.precio_particular)}</td>
                    {esAdmin && <td className="mini">{p.opcion2_proveedor ? `${p.opcion2_proveedor} ${fmt(p.opcion2_precio)}` : "—"}</td>}
                    {esAdmin && <td className="mini">{p.opcion3_proveedor ? `${p.opcion3_proveedor} ${fmt(p.opcion3_precio)}` : "—"}</td>}
                    {esAdmin && <td className="mini revisar-cell" title={p.revisar || ""}>{p.confirmado ? <span style={{ color: "var(--success)" }}>OK CONFIRM.</span> : p.revisar || ""}</td>}
                    <td>
                      <div className="actions">
                        {esAdmin && <button className="btn btn-ghost btn-sm" onClick={() => setPrecios(p)}>Precios</button>}
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditar(p)}>Editar</button>
                        <button className={`btn btn-sm ${enCotizacion(p.id) ? "btn-success" : "btn-ghost"}`} onClick={() => onCotizar(p)}>
                          {enCotizacion(p.id) ? "✓ En cot." : "+ Cotizar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="mini">{productos.length.toLocaleString("es-CL")} productos{productos.length > mostrar ? ` · mostrando ${mostrar}` : ""}</span>
        {productos.length > mostrar && <button className="btn btn-ghost btn-sm" onClick={() => setMostrar((m) => m + POR_PAGINA * 2)}>Ver más</button>}
      </div>

      {editar && <EditarProducto producto={editar} esAdmin={esAdmin} categorias={categorias} proveedores={proveedores} notify={notify}
        onClose={() => setEditar(null)} onGuardado={() => { setEditar(null); refrescar(); }} />}
      {documento && <DocumentoProveedor notify={notify} proveedores={proveedores} categorias={categorias} onClose={() => { setDocumento(false); refrescar(); }} />}
      {precios && <PreciosProducto producto={precios} proveedores={proveedores} notify={notify}
        onClose={() => setPrecios(null)} onCambio={refrescar} />}
    </>
  );
}

function EditarProducto({ producto, esAdmin, categorias, proveedores, notify, onClose, onGuardado }) {
  const nuevo = !producto.id;
  const [form, setForm] = useState({ ...producto, precio_compra: "", proveedor: "" });
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    if (!form.nombre?.trim()) return notify("La descripción es obligatoria", "danger");
    setGuardando(true);
    try {
      const body = { nombre: form.nombre, categoria: form.categoria, unidad: form.unidad, codigo: form.codigo || undefined };
      if (nuevo) {
        if (esAdmin && Number(form.precio_compra) > 0) Object.assign(body, { precio_compra: Number(form.precio_compra), proveedor: form.proveedor });
        await api("/productos", { method: "POST", body });
      } else {
        await api(`/productos/${producto.id}`, { method: "PUT", body });
      }
      notify(nuevo ? "✓ Producto creado" : "✓ Producto actualizado");
      onGuardado();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  const desactivar = async () => {
    if (!confirm(`¿Eliminar "${producto.nombre}"? Si tiene historial de precios solo se desactiva.`)) return;
    try { const r = await api(`/productos/${producto.id}`, { method: "DELETE" }); notify(r.message || "Producto eliminado", "danger"); onGuardado(); }
    catch (e) { notify(e.message, "danger"); }
  };

  return (
    <Modal titulo={nuevo ? "// Nuevo producto" : `// Editar N° ${producto.codigo ?? ""}`} onClose={onClose}
      footer={<>
        {!nuevo && esAdmin && <button className="btn btn-danger" onClick={desactivar}>Eliminar</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</button>
      </>}>
      {nuevo && <div className="mini">Un producto parecido pero distinto (otra calidad, marca o medida) va como línea aparte.</div>}
      <div className="field">
        <label>Descripción estándar</label>
        <input value={form.nombre || ""} onChange={(e) => set("nombre", e.target.value)} placeholder='Ej: TUBERÍA PVC HIDRÁULICA PRESIÓN 20 MM X 6 MT' />
      </div>
      <div className="fields-row">
        <div className="field">
          <label>Categoría</label>
          <input list="lista-categorias" value={form.categoria || ""} onChange={(e) => set("categoria", e.target.value.toUpperCase())} />
          <datalist id="lista-categorias">{categorias.map((c) => <option key={c.categoria} value={c.categoria} />)}</datalist>
        </div>
        <div className="field">
          <label>Unidad</label>
          <input list="lista-unidades" value={form.unidad || ""} onChange={(e) => set("unidad", e.target.value.toUpperCase())} />
          <datalist id="lista-unidades">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
      </div>
      {nuevo && esAdmin && (
        <div className="fields-row">
          <div className="field">
            <label>Precio compra neto (opcional)</label>
            <input type="number" value={form.precio_compra} onChange={(e) => set("precio_compra", e.target.value)} />
          </div>
          <div className="field">
            <label>Proveedor</label>
            <input list="lista-proveedores" value={form.proveedor} onChange={(e) => set("proveedor", e.target.value.toUpperCase())} />
            <datalist id="lista-proveedores">{proveedores.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
          </div>
        </div>
      )}
      {!nuevo && <div className="mini">Los precios se cambian en <strong>Precios</strong>: cada precio queda en el historial con su fecha.</div>}
    </Modal>
  );
}

const PRECIO_VACIO = { proveedor: "", precio: "", con_iva: false, total_linea: "", cantidad: "", fecha: "", documento: "", descripcion_proveedor: "", marca: "", calce: "exacto" };

function PreciosProducto({ producto: inicial, proveedores, notify, onClose, onCambio }) {
  const [producto, setProducto] = useState(inicial);
  const [hist, setHist] = useState(null);
  const [form, setForm] = useState({ ...PRECIO_VACIO, fecha: hoyISO() });
  const [porTotal, setPorTotal] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [verCambios, setVerCambios] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const cargar = useCallback(async () => {
    try { setHist(await api(`/productos/${inicial.id}/precios`)); } catch (e) { notify(e.message, "danger"); }
  }, [inicial.id, notify]);
  useEffect(() => { cargar(); }, [cargar]);

  const despues = (p, msg) => { setProducto(p); cargar(); onCambio(); notify(msg); };
  const accion = async (fn, msg) => {
    try { despues(await fn(), msg); } catch (e) { notify(e.message, "danger"); }
  };

  const agregar = async () => {
    setEnviando(true);
    try {
      const body = { ...form };
      if (porTotal) delete body.precio; else { delete body.total_linea; }
      const r = await api(`/productos/${producto.id}/precios`, { method: "POST", body });
      despues(r.producto, `✓ Precio ${r.precio.proveedor} ${fmt(r.precio.precio)} registrado`);
      setForm({ ...PRECIO_VACIO, fecha: form.fecha });
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  const descartar = (pr) => {
    const motivo = prompt(`Motivo para descartar ${pr.proveedor} ${fmt(pr.precio)} (otra medida, otra calidad, precio antiguo...):`);
    if (motivo) accion(() => api(`/precios/${pr.id}/descartar`, { method: "POST", body: { motivo } }), "Precio descartado");
  };

  const sinPrecio = !(Number(producto.precio_compra) > 0);
  const precioPrevio = porTotal
    ? (Number(form.total_linea) > 0 && Number(form.cantidad) > 0 ? Number(form.total_linea) / Number(form.cantidad) : 0)
    : Number(form.precio) || 0;
  const neto = Math.round(form.con_iva ? precioPrevio / 1.19 : precioPrevio);

  return (
    <Modal titulo={`// Precios · N° ${producto.codigo ?? ""}`} onClose={onClose} ancho={980}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="hist-nombre">{producto.nombre} <span className="mini">{producto.unidad} · {producto.categoria}</span></div>

      <div className="vigente">
        <div className="vigente-principal">
          <span className="stat-label">Precio compra vigente</span>
          <strong>{sinPrecio ? "Sin precio" : fmt(producto.precio_compra)}</strong>
          <span className="mini">{producto.proveedor || "—"}{producto.fecha_precio ? ` · ${fecha(producto.fecha_precio)}` : ""}</span>
          {producto.confirmado ? <span className="estado estado-ok">✓ Confirmado</span> : !sinPrecio && <span className="estado estado-warn">Sin confirmar</span>}
        </div>
        <div><span className="stat-label">Convenio</span><strong>{fmt(producto.precio_convenio)}</strong></div>
        <div><span className="stat-label">Particular</span><strong>{fmt(producto.precio_particular)}</strong></div>
        <div><span className="stat-label">Opción 2</span><strong>{producto.opcion2_proveedor ? fmt(producto.opcion2_precio) : "—"}</strong><span className="mini">{producto.opcion2_proveedor || ""}</span></div>
        <div><span className="stat-label">Opción 3</span><strong>{producto.opcion3_proveedor ? fmt(producto.opcion3_precio) : "—"}</strong><span className="mini">{producto.opcion3_proveedor || ""}</span></div>
      </div>
      {producto.revisar && !producto.confirmado && <div className="aviso" style={{ marginBottom: 0 }}>REVISAR: {producto.revisar}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!sinPrecio && !producto.confirmado && <button className="btn btn-success btn-sm" onClick={() => accion(() => api(`/productos/${producto.id}/confirmar`, { method: "POST", body: {} }), "✓ Precio confirmado")}>✓ Confirmar precio vigente</button>}
        {producto.confirmado && <button className="btn btn-ghost btn-sm" onClick={() => accion(() => api(`/productos/${producto.id}/desconfirmar`, { method: "POST" }), "Confirmación quitada")}>Quitar confirmación</button>}
        <span className="mini" style={{ alignSelf: "center" }}>Un precio confirmado solo lo reemplaza una cotización nueva más barata.</span>
      </div>

      <div className="panel">
        <div className="panel-titulo">Cargar precio de proveedor</div>
        <div className="fields-row tres">
          <div className="field">
            <label>Proveedor</label>
            <input list="lista-proveedores-precio" value={form.proveedor} onChange={(e) => set("proveedor", e.target.value.toUpperCase())} placeholder="MADESUR, CYC..." />
            <datalist id="lista-proveedores-precio">{proveedores.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
          </div>
          {porTotal ? (
            <div className="fields-row" style={{ gap: 6 }}>
              <div className="field"><label>Total línea</label><input type="number" value={form.total_linea} onChange={(e) => set("total_linea", e.target.value)} /></div>
              <div className="field"><label>Cantidad</label><input type="number" value={form.cantidad} onChange={(e) => set("cantidad", e.target.value)} /></div>
            </div>
          ) : (
            <div className="field"><label>Precio unitario</label><input type="number" value={form.precio} onChange={(e) => set("precio", e.target.value)} /></div>
          )}
          <div className="field"><label>Fecha</label><input type="date" value={form.fecha} onChange={(e) => set("fecha", e.target.value)} /></div>
        </div>
        <div className="fields-row tres">
          <div className="field"><label>N° cotización / factura</label><input value={form.documento} onChange={(e) => set("documento", e.target.value)} placeholder="COT MA00041930" /></div>
          <div className="field"><label>Marca</label><input value={form.marca} onChange={(e) => set("marca", e.target.value)} /></div>
          <div className="field">
            <label>Calce</label>
            <select value={form.calce} onChange={(e) => set("calce", e.target.value)}>
              <option value="exacto">Exacto</option><option value="equivalente">Equivalente (otra marca)</option><option value="parecido">Parecido</option>
            </select>
          </div>
        </div>
        <div className="field"><label>Descripción del proveedor (tal cual viene)</label><input value={form.descripcion_proveedor} onChange={(e) => set("descripcion_proveedor", e.target.value)} /></div>
        <div className="pago-form">
          <label className="check"><input type="checkbox" checked={form.con_iva} onChange={(e) => set("con_iva", e.target.checked)} />Precio con IVA (web/tienda) — se divide por 1,19</label>
          <label className="check"><input type="checkbox" checked={porTotal} onChange={(e) => setPorTotal(e.target.checked)} />Solo tengo el total de la línea</label>
          <span className="mini" style={{ marginLeft: "auto" }}>Neto unitario: <strong style={{ color: "var(--accent)" }}>{neto ? fmt(neto) : "—"}</strong></span>
          <button className="btn btn-primary btn-sm" disabled={enviando || !form.proveedor || !neto} onClick={agregar}>{enviando ? "Guardando..." : "+ Registrar precio"}</button>
        </div>
        {form.calce === "parecido" && <div className="mini" style={{ color: "var(--warn)" }}>Si es otra calidad, marca o medida, conviene crear un producto aparte en vez de cargarlo aquí.</div>}
      </div>

      <div className="panel">
        <div className="panel-titulo">
          Historial de precios
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setVerCambios((v) => !v)}>{verCambios ? "Ver precios" : "Ver registro de cambios"}</button>
        </div>
        {!hist ? <span className="mini"><span className="spinner"></span>Cargando...</span> : verCambios ? (
          hist.cambios.length === 0 ? <div className="mini">Sin cambios registrados</div> : (
            <table className="table table-compacta">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Campo</th><th>Antes</th><th>Después</th><th>Motivo</th></tr></thead>
              <tbody>{hist.cambios.map((c) => (
                <tr key={c.id}><td className="mini">{new Date(c.createdAt).toLocaleString("es-CL")}</td><td className="mini">{c.usuario}</td><td className="mini">{c.campo}</td><td className="mini">{c.antes}</td><td className="mini">{c.despues}</td><td className="mini">{c.motivo}</td></tr>
              ))}</tbody>
            </table>
          )
        ) : hist.precios.length === 0 ? <div className="mini">Sin precios registrados</div> : (
          <table className="table table-compacta">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Neto unit.</th><th>Documento</th><th>Descripción proveedor</th><th>Calce</th><th></th></tr></thead>
            <tbody>{hist.precios.map((pr) => (
              <tr key={pr.id} className={pr.descartado ? "fila-anulada" : ""}>
                <td className="mini">{fecha(pr.fecha)}</td>
                <td className="mini">{pr.proveedor}{pr.origen === "web" ? " (web)" : ""}</td>
                <td className="price-cell compra">{fmt(pr.precio)}</td>
                <td className="mini">{pr.documento || "—"}</td>
                <td className="mini">{pr.descripcion_proveedor || ""}{pr.marca ? ` · ${pr.marca}` : ""}{pr.descartado ? ` · DESCARTADO: ${pr.motivo || ""}` : ""}</td>
                <td className="mini">{pr.calce || ""}</td>
                <td>
                  <div className="actions">
                    {pr.descartado
                      ? <button className="btn btn-ghost btn-sm" onClick={() => accion(() => api(`/precios/${pr.id}/restaurar`, { method: "POST" }), "Precio restaurado")}>Restaurar</button>
                      : <>
                        <button className="btn btn-ghost btn-sm" title="Usar y confirmar este precio" onClick={() => accion(() => api(`/productos/${producto.id}/confirmar`, { method: "POST", body: { precio_id: pr.id } }), `✓ Confirmado ${pr.proveedor}`)}>Usar</button>
                        <button className="btn btn-danger btn-sm" title="Descartar" onClick={() => descartar(pr)}>✕</button>
                      </>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

