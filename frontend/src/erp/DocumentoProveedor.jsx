import { useState, useEffect } from "react";
import { Modal, Estado, SelectorProducto, CuadreDocumento, aplicarFactorPrecios } from "./ui";
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
        valido_hasta: e.valido_hasta || "", vigencia_supuesta: !!e.vigencia_supuesta, tipo_documento: e.tipo_documento,
      });
      setLineas(r.lineas.map((l, i) => ({
        // Mismo precio que el último de este proveedor: ya está cargado (queda desmarcado)
        ...l, i, omitir: !!l.ya_cargado,
        // Regla: el precio va al producto exacto que cotizó el proveedor (tineta ≠ galón, otra medida o color ≠).
        // Si solo hay uno "parecido", se propone crear el producto con la descripción del proveedor.
        accion: l.producto && l.calce !== "parecido" ? "existente" : "nuevo",
        nuevo: { nombre: l.descripcion.toUpperCase(), categoria: (l.producto?.categoria && categorias.some((c) => c.categoria === l.producto.categoria) ? l.producto.categoria : null) || categorias.find((c) => c.categoria === "POR CLASIFICAR")?.categoria || categorias[0]?.categoria || "GENERAL", unidad: (l.unidad || "UNIDAD").toUpperCase() },
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
          ...enc, hash: res.hash, archivo: res.archivo,
          lineas: activas.map((l) => ({
            antes: l.anterior?.precio ?? null,
            producto_id: l.accion === "existente" ? l.producto.id : null,
            renombrar: l.accion === "existente" && l.renombrar && l.renombrar.trim() && l.renombrar.trim() !== l.producto.nombre ? l.renombrar.trim() : null,
            nuevo: l.accion === "nuevo" ? l.nuevo : null,
            // Pack (ej. "pack x4"): el precio leído es del pack; se guarda por unidad
            precio: Number(l.pack) > 1 ? Math.round(Number(l.precio_neto) / Number(l.pack)) : Number(l.precio_neto),
            pack: Number(l.pack) > 1 ? Number(l.pack) : null,
            descripcion_proveedor: l.descripcion, marca: l.marca, unidad: l.unidad,
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
        <button className="btn btn-primary" disabled={!activas.length || !enc.proveedor || guardando} onClick={aprobar}>{guardando ? "Guardando..." : lineas.some((l) => l.ya_cargado) ? "Aplicar solo lo que cambió" : "Aprobar y guardar precios"}</button>
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
          {!["factura", "boleta"].includes(enc.tipo_documento) && <div className="fields-row" style={{ alignItems: "center" }}>
            <div className="field" style={{ maxWidth: 220 }}><label>Cotización válida hasta</label><input type="date" value={enc.valido_hasta || ""} onChange={(e) => setEnc({ ...enc, valido_hasta: e.target.value, vigencia_supuesta: false })} /></div>
            <div className="mini">{enc.vigencia_supuesta ? "El documento no dice vigencia: se usaron los días de Configuración (5)." : "Según el documento."}{enc.valido_hasta && enc.valido_hasta < hoyISO() ? <strong style={{ color: "var(--danger)" }}> Ya está vencida: los precios se guardan marcados como vencidos.</strong> : ""}</div>
          </div>}
          {(() => {
            const rep = res.repetido; const ya = lineas.filter((l) => l.ya_cargado).length; const cambian = lineas.filter((l) => l.anterior && !l.ya_cargado).length;
            if (!rep && !ya) return null;
            return (
              <div className="aviso" style={{ borderColor: rep ? "var(--danger)" : undefined }}>
                {rep?.motivo === "archivo" && <div>⚠ <strong>Este archivo ya se subió</strong> el {new Date(rep.fecha).toLocaleDateString("es-CL")}{rep.usuario ? ` por ${rep.usuario}` : ""} ({rep.proveedor}{rep.documento ? `, N° ${rep.documento}` : ""}).</div>}
                {rep?.motivo === "numero" && <div>⚠ <strong>Ya está cargado</strong> el documento N° {rep.documento} de {rep.proveedor}{rep.fecha ? ` (${new Date(rep.fecha).toLocaleDateString("es-CL")}${rep.usuario ? `, ${rep.usuario}` : ""})` : ""}.</div>}
                {rep?.motivo === "precios" && <div>⚠ <strong>Parece repetido:</strong> {rep.iguales} de {rep.total} productos ya tienen este mismo precio de {rep.proveedor}.</div>}
                {ya > 0 && <div>{ya} línea(s) con el mismo precio quedaron desmarcadas ("ya cargado"){cambian ? `; ${cambian} traen otro monto y quedan marcadas` : ""}. Se guarda solo lo marcado.</div>}
              </div>
            );
          })()}
          <div className="pago-form">
            <label className="check"><input type="checkbox" checked={enc.origen === "web"} onChange={(e) => setEnc({ ...enc, origen: e.target.checked ? "web" : "proveedor" })} />Es tienda web</label>
            {res.control.precios_incluyen_iva && <span className="estado estado-info">Precios venían con IVA: ya se dividieron por 1,19</span>}
            <CuadreDocumento control={res.control} lineas={lineas} onAplicar={(f) => setLineas(aplicarFactorPrecios(lineas, f))} />
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
                      <td>{l.descripcion}<div className="mini">{[l.codigo_proveedor, l.marca, l.unidad].filter(Boolean).join(" · ")}</div>
                        {l.ya_cargado && <div className="mini"><span className="estado estado-neutral">ya cargado</span> {fmt(l.anterior.precio)}{l.anterior.documento ? ` · ${l.anterior.documento}` : ""}</div>}
                        {l.anterior && !l.ya_cargado && <div className="mini" style={{ color: "var(--warn)" }}>cambió: antes {fmt(l.anterior.precio)} → ahora {fmt(l.precio_neto)}</div>}</td>
                      <td className="mini">{l.cantidad}</td>
                      <td><input className="qty-input" style={{ width: 90 }} type="number" value={l.precio_neto} onChange={(e) => set(l.i, { precio_neto: e.target.value })} />
                        <div className="mini" style={{ marginTop: 4, whiteSpace: "nowrap" }} title="Si el precio es de un pack o set (ej. pack x4), cuántas unidades trae">pack de <input className="qty-input" style={{ width: 44 }} type="number" min="1" value={l.pack || ""} placeholder="1" onChange={(e) => set(l.i, { pack: e.target.value })} /></div>
                        {Number(l.pack) > 1 && <div className="mini">= {fmt(Math.round(Number(l.precio_neto) / Number(l.pack)))} c/u</div>}</td>
                      <td><Estado valor={l.accion === "nuevo" ? "sin_producto" : l.calce} />{l.nota && <div className="mini" style={{ maxWidth: 180 }}>{l.nota}</div>}</td>
                      <td>
                        <select className="select-linea" value={l.accion} onChange={(e) => set(l.i, { accion: e.target.value })} style={{ marginBottom: 4 }}>
                          <option value="existente">Producto del catálogo</option>
                          <option value="nuevo">Crear producto nuevo</option>
                        </select>
                        {l.accion === "existente" ? (<>
                          <SelectorProducto valor={l.producto} candidatos={l.candidatos} productos={productos} precioDe={(p) => p.precio_compra}
                            onChange={(p) => set(l.i, p && p.id !== l.producto?.id
                              // Otro producto: ya no es "ya cargado" (ese precio no está en el producto nuevo) y queda marcada para guardar
                              ? { producto: p, calce: "exacto", nota: "Elegido a mano", ya_cargado: false, anterior: null, omitir: false, renombrar: undefined }
                              : { producto: p, renombrar: undefined })} />
                        {l.accion === "existente" && l.producto && (l.renombrar === undefined
                          ? <button className="link mini" title="Cambiar la descripción del producto del catálogo al guardar (ej. dejarla más general para juntar variantes)" onClick={() => set(l.i, { renombrar: l.producto.nombre })}>✎ editar descripción</button>
                          : <div style={{ marginTop: 4 }}>
                              <input className="qty-input" style={{ width: "100%", textAlign: "left" }} value={l.renombrar} onChange={(e) => set(l.i, { renombrar: e.target.value.toUpperCase() })} />
                              <div className="mini">{l.renombrar.trim() && l.renombrar.trim() !== l.producto.nombre ? <>Al guardar, N° {l.producto.codigo} se llamará así en todo el catálogo.</> : "Sin cambios en la descripción."} <button className="link mini" onClick={() => set(l.i, { renombrar: undefined })}>cancelar</button></div>
                            </div>)}
                        </>) : (
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
