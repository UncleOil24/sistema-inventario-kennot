import { useState, useEffect } from "react";
import { Modal, Estado, SelectorProducto } from "./ui";
import { api, fmt, subirArchivo, useProductos, invalidarProductos, hoyISO } from "./lib";

// Carga la cotización o factura de un proveedor (PDF o foto). Claude extrae las líneas y propone
// el producto del catálogo; compras revisa y aprueba, y el sistema recalcula precio vigente y opciones.
export default function DocumentoProveedor({ notify, onClose, proveedores = [], categorias: cats = [] }) {
  const productos = useProductos();
  const [categorias, setCategorias] = useState(cats);
  useEffect(() => { if (!cats.length) api("/productos/categorias").then(setCategorias).catch(() => {}); }, [cats.length]);
  const [archivo, setArchivo] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [res, setRes] = useState(null);
  const [enc, setEnc] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const leer = async () => {
    if (!archivo) return;
    setLeyendo(true);
    try {
      const r = await subirArchivo("/ia/documento-proveedor", archivo);
      setRes(r);
      const e = r.encabezado;
      setEnc({
        proveedor: r.proveedor_existente?.nombre || e.proveedor,
        documento: [e.tipo_documento === "factura" ? "FACT." : e.tipo_documento === "cotizacion" ? "COT" : "", e.numero_documento].filter(Boolean).join(" "),
        fecha: e.fecha || hoyISO(),
        origen: r.proveedor_existente?.tipo === "web" || e.tipo_documento === "web" ? "web" : "proveedor",
        razon_social: e.razon_social, rut: e.rut,
      });
      setLineas(r.lineas.map((l, i) => ({
        ...l, i, omitir: false,
        accion: l.producto ? "existente" : "nuevo",
        nuevo: { nombre: l.descripcion.toUpperCase(), categoria: categorias[0]?.categoria || "GENERAL", unidad: (l.unidad || "UNIDAD").toUpperCase() },
      })));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };

  const set = (i, cambios) => setLineas((ls) => ls.map((l) => (l.i === i ? { ...l, ...cambios } : l)));
  const activas = lineas.filter((l) => !l.omitir && (l.accion === "nuevo" ? l.nuevo.nombre : l.producto));

  const aprobar = async () => {
    setGuardando(true);
    try {
      const r = await api("/ia/documento-proveedor/aprobar", {
        method: "POST",
        body: {
          ...enc,
          lineas: activas.map((l) => ({
            producto_id: l.accion === "existente" ? l.producto.id : null,
            nuevo: l.accion === "nuevo" ? l.nuevo : null,
            precio: Number(l.precio_neto), descripcion_proveedor: l.descripcion, marca: l.marca, unidad: l.unidad,
            cantidad: l.cantidad, calce: l.calce,
          })),
        },
      });
      invalidarProductos();
      setResultado(r);
      notify(`✓ ${r.precios} precios guardados${r.productos_nuevos ? ` · ${r.productos_nuevos} productos nuevos` : ""}`);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  if (resultado) {
    return (
      <Modal titulo="// Documento guardado" onClose={onClose} ancho={760} footer={<button className="btn btn-primary" onClick={onClose}>Listo</button>}>
        <div className="mini">{resultado.precios} precios guardados en el historial de {enc.proveedor}{resultado.productos_nuevos ? ` · ${resultado.productos_nuevos} productos nuevos creados` : ""}.</div>
        {resultado.cambios_precio.length === 0 ? <div className="mini">Ningún precio vigente cambió (los precios cargados no eran más baratos, o hay precios confirmados).</div> : (
          <table className="table table-compacta">
            <thead><tr><th>N°</th><th>Producto</th><th>Antes</th><th>Ahora</th><th>Proveedor</th></tr></thead>
            <tbody>{resultado.cambios_precio.map((c) => (
              <tr key={c.codigo}><td className="id-cell">{c.codigo}</td><td>{c.nombre}</td><td className="price-cell compra">{c.antes ? fmt(c.antes) : "—"}</td><td className="price-cell">{fmt(c.despues)}</td><td className="mini">{c.proveedor}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Modal>
    );
  }

  return (
    <Modal titulo="// Cargar cotización o factura de proveedor" onClose={onClose} ancho={1200}
      footer={res ? <>
        <span className="mini" style={{ marginRight: "auto" }}>{activas.length} de {lineas.length} líneas se guardarán</span>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!activas.length || !enc.proveedor || guardando} onClick={aprobar}>{guardando ? "Guardando..." : "Aprobar y guardar precios"}</button>
      </> : <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!archivo || leyendo} onClick={leer}>{leyendo ? <><span className="spinner"></span>Leyendo con Claude...</> : "Leer documento"}</button>
      </>}>
      {!res ? (
        <>
          <div className="mini">Sube el PDF o la foto de la cotización o factura. Claude extrae proveedor, N°, fecha y cada línea con su precio unitario neto, y propone el producto del catálogo. Nada se guarda hasta que apruebes.</div>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        </>
      ) : (
        <>
          <div className="fields-row tres">
            <div className="field">
              <label>Proveedor {res.proveedor_existente ? "" : "(nuevo)"}</label>
              <input list="lista-prov-doc" value={enc.proveedor} onChange={(e) => setEnc({ ...enc, proveedor: e.target.value.toUpperCase() })} />
              <datalist id="lista-prov-doc">{proveedores.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
            </div>
            <div className="field"><label>N° documento</label><input value={enc.documento} onChange={(e) => setEnc({ ...enc, documento: e.target.value })} /></div>
            <div className="field"><label>Fecha</label><input type="date" value={enc.fecha} onChange={(e) => setEnc({ ...enc, fecha: e.target.value })} /></div>
          </div>
          <div className="pago-form">
            <label className="check"><input type="checkbox" checked={enc.origen === "web"} onChange={(e) => setEnc({ ...enc, origen: e.target.checked ? "web" : "proveedor" })} />Es tienda web</label>
            {res.control.precios_incluyen_iva && <span className="estado estado-info">Precios venían con IVA: ya se dividieron por 1,19</span>}
            {res.control.cuadra === true && <span className="estado estado-ok">✓ La suma de las líneas cuadra con el total ({fmt(res.control.total_documento)})</span>}
            {res.control.cuadra === false && <span className="estado estado-warn">⚠ La suma de las líneas ({fmt(res.control.suma_lineas)}) no cuadra con el total del documento ({fmt(res.control.total_documento)}): revisa</span>}
            {res.control.cuadra === null && <span className="mini">El documento no muestra total para comprobar.</span>}
          </div>
          {res.truncado && <div className="aviso">El documento es muy largo y la lectura pudo quedar incompleta.</div>}
          <div className="table-wrap">
            <table className="table table-compacta">
              <thead><tr><th></th><th>Descripción del proveedor</th><th>Cant.</th><th>Neto unit.</th><th>Calce</th><th className="col-desc">Producto nuestro</th><th>Vigente hoy</th></tr></thead>
              <tbody>
                {lineas.map((l) => {
                  const alerta = l.calce === "parecido" || l.accion === "nuevo";
                  return (
                    <tr key={l.i} className={l.omitir ? "fila-anulada" : alerta ? "fila-alerta" : ""}>
                      <td><input type="checkbox" checked={!l.omitir} onChange={(e) => set(l.i, { omitir: !e.target.checked })} title="Incluir" /></td>
                      <td>{l.descripcion}<div className="mini">{[l.codigo_proveedor, l.marca, l.unidad].filter(Boolean).join(" · ")}</div></td>
                      <td className="mini">{l.cantidad}</td>
                      <td><input className="qty-input" style={{ width: 90 }} type="number" value={l.precio_neto} onChange={(e) => set(l.i, { precio_neto: e.target.value })} /></td>
                      <td><Estado valor={l.accion === "nuevo" ? "sin_producto" : l.calce} />{l.nota && <div className="mini" style={{ maxWidth: 180 }}>{l.nota}</div>}</td>
                      <td>
                        <select className="select-linea" value={l.accion} onChange={(e) => set(l.i, { accion: e.target.value })} style={{ marginBottom: 4 }}>
                          <option value="existente">Producto del catálogo</option>
                          <option value="nuevo">Crear producto nuevo</option>
                        </select>
                        {l.accion === "existente" ? (
                          <SelectorProducto valor={l.producto} candidatos={l.candidatos} productos={productos} precioDe={(p) => p.precio_compra}
                            onChange={(p) => set(l.i, { producto: p, calce: p && p.id !== l.producto?.id ? "exacto" : l.calce, nota: p && p.id !== l.producto?.id ? "Elegido a mano" : l.nota })} />
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <input className="qty-input" style={{ width: "100%", textAlign: "left" }} value={l.nuevo.nombre} onChange={(e) => set(l.i, { nuevo: { ...l.nuevo, nombre: e.target.value.toUpperCase() } })} placeholder="Descripción estándar" />
                            <div style={{ display: "flex", gap: 4 }}>
                              <select className="select-linea" value={l.nuevo.categoria} onChange={(e) => set(l.i, { nuevo: { ...l.nuevo, categoria: e.target.value } })}>
                                {categorias.map((c) => <option key={c.categoria}>{c.categoria}</option>)}
                              </select>
                              <input className="qty-input" style={{ width: 90 }} value={l.nuevo.unidad} onChange={(e) => set(l.i, { nuevo: { ...l.nuevo, unidad: e.target.value.toUpperCase() } })} />
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="mini">
                        {l.accion === "existente" && l.producto ? (
                          Number(l.producto.precio_compra) > 0
                            ? <>{fmt(l.producto.precio_compra)} {l.producto.proveedor}{Number(l.precio_neto) < Number(l.producto.precio_compra) && <div style={{ color: "var(--success)" }}>más barato</div>}</>
                            : "sin precio"
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mini">Un producto parecido pero distinto (otra calidad, marca o medida) conviene crearlo como producto nuevo. La descripción del proveedor se guarda tal cual.</div>
        </>
      )}
    </Modal>
  );
}
