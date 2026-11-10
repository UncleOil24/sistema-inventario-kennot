// Facturas y guías emitidas en el portal gratuito del SII: ficha para copiar los datos y lectura del PDF emitido.
// El sistema no se conecta al SII ni guarda la clave ni la firma electrónica.
import { useState, useEffect } from "react";
import { Modal } from "./ui";
import { api, fmt, fecha, subirArchivo, descargar } from "./lib";

const copiar = async (texto, notify) => {
  try { await navigator.clipboard.writeText(String(texto ?? "")); notify("✓ Copiado"); }
  catch { notify("No se pudo copiar: selecciónalo y copia con Ctrl+C", "danger"); }
};
function Dato({ label, valor, notify, falta }) {
  return (
    <div className="dato-sii">
      <span className="mini">{label}</span>
      <span className={falta ? "falta" : ""}>{valor || (falta ? "— falta en la ficha del cliente —" : "—")}</span>
      {valor ? <button className="btn btn-ghost btn-sm" onClick={() => copiar(valor, notify)}>Copiar</button> : <span />}
    </div>
  );
}

export function FichaSII({ venta, notify, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => { api(`/ventas/${venta.id}/sii`).then(setD).catch((e) => { notify(e.message, "danger"); onClose(); }); }, [venta.id, notify, onClose]);
  const r = d?.receptor || {};
  const detalleTexto = d ? d.items.map((i) => `${i.descripcion}\t${i.cantidad}\t${i.unidad}\t${i.precio_neto}`).join("\n") : "";
  return (
    <Modal titulo={`// Copiar al SII · ${venta.numero}`} onClose={onClose} ancho={820}
      footer={<><a className="btn btn-ghost" href="https://www.sii.cl" target="_blank" rel="noreferrer">Abrir portal del SII ↗</a><button className="btn btn-ghost" onClick={onClose}>Cerrar</button></>}>
      {!d ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div> : <>
        <div className="mini" style={{ marginBottom: 8 }}>Emite con <strong>{d.emisor.razon_social || d.emisor.empresa}</strong>{d.emisor.rut ? ` (RUT ${d.emisor.rut})` : ""}. Copia cada dato al formulario del portal, en este orden.</div>
        {r.faltan?.length > 0 && <div className="aviso">Al cliente le falta {r.faltan.join(", ")}: complétalo en Clientes → Editar para que quede para la próxima vez.</div>}
        <div className="panel-titulo">Receptor</div>
        <Dato label="RUT" valor={r.rut} notify={notify} falta={!r.rut} />
        <Dato label="Razón social" valor={r.razon_social} notify={notify} />
        <Dato label="Giro" valor={r.giro} notify={notify} falta={!r.giro} />
        <Dato label="Dirección" valor={r.direccion} notify={notify} falta={!r.direccion} />
        <Dato label="Comuna" valor={r.comuna} notify={notify} falta={!r.comuna} />
        <div className="panel-titulo" style={{ marginTop: 10 }}>Referencias</div>
        <Dato label="Orden de compra" valor={d.referencias.oc} notify={notify} />
        <Dato label="ID solicitud" valor={d.referencias.id_solicitud} notify={notify} />
        <Dato label="Cotización" valor={d.referencias.cotizacion} notify={notify} />
        <div className="panel-titulo" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
          Detalle ({d.items.length} líneas, precios netos)
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => copiar(detalleTexto, notify)}>Copiar todo el detalle</button>
        </div>
        <table className="table table-compacta">
          <thead><tr><th>N°</th><th>Descripción</th><th>Cant.</th><th>Unidad</th><th>Precio neto</th><th>Total neto</th><th></th></tr></thead>
          <tbody>{d.items.map((i) => (
            <tr key={i.n}><td className="mini">{i.n}</td><td>{i.descripcion}</td><td>{i.cantidad}</td><td className="mini">{i.unidad}</td>
              <td className="price-cell">{fmt(i.precio_neto)}</td><td className="price-cell">{fmt(i.total_neto)}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => copiar(i.descripcion, notify)}>Copiar</button></td></tr>
          ))}</tbody>
        </table>
        <div className="mini" style={{ textAlign: "right", marginTop: 6 }}>Neto {fmt(d.neto)} · IVA {fmt(d.iva)} · <strong>Total {fmt(d.total)}</strong>{d.falta_facturar < d.total ? ` · falta facturar ${fmt(d.falta_facturar)}` : ""}</div>
        <div className="panel-titulo" style={{ marginTop: 10 }}>Para la guía de despacho</div>
        <Dato label="Lugar de entrega" valor={d.entrega.lugar || [r.direccion, r.comuna].filter(Boolean).join(", ")} notify={notify} />
        <div className="mini" style={{ marginTop: 10 }}>Después de emitir, descarga el PDF del SII y súbelo con "Subir factura / guía del SII": queda registrado solo.</div>
      </>}
    </Modal>
  );
}

const TIPOS = { factura: "Factura", factura_exenta: "Factura exenta", guia: "Guía de despacho", nota_credito: "Nota de crédito", otro: "Otro" };
export function SubirSII({ venta, notify, onClose, onHecho }) {
  const [leyendo, setLeyendo] = useState(false);
  const [d, setD] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const leer = async (archivo) => {
    if (!archivo) return;
    setLeyendo(true);
    try { setD(await subirArchivo(`/ventas/${venta.id}/sii/leer`, archivo)); }
    catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };
  const registrar = async () => {
    setGuardando(true);
    try {
      await api(`/ventas/${venta.id}/sii/registrar`, { method: "POST", body: { tipo: d.tipo, folio: d.folio, fecha: d.fecha, monto: d.total, archivo_token: d.archivo_token } });
      notify(`✓ ${TIPOS[d.tipo]} N° ${d.folio} registrada${d.tipo === "guia" ? ": ya se puede despachar" : ""}`);
      onHecho();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  return (
    <Modal titulo={`// Subir factura / guía del SII · ${venta.numero}`} onClose={onClose} ancho={620}
      footer={d && <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || !d.folio || d.tipo === "otro"} onClick={registrar}>{guardando ? "Registrando..." : "Registrar en la venta"}</button>
      </>}>
      {!d ? (
        <div className="field">
          <label>PDF del documento emitido en el SII (o foto)</label>
          <input type="file" accept=".pdf,image/*" disabled={leyendo} onChange={(e) => leer(e.target.files[0])} />
          {leyendo && <div className="mini"><span className="spinner"></span> Leyendo el documento...</div>}
          <div className="mini">Se leen el tipo, el folio, la fecha y los montos, y se comparan con la venta. Revisa antes de registrar.</div>
        </div>
      ) : <>
        {d.avisos?.length > 0 && <div className="aviso">{d.avisos.map((a) => <div key={a}>⚠ {a}</div>)}</div>}
        <div className="fields-row">
          <div className="field"><label>Tipo</label>
            <select value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })}>{Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
          <div className="field"><label>Folio</label><input value={d.folio || ""} onChange={(e) => setD({ ...d, folio: e.target.value })} /></div>
        </div>
        <div className="fields-row">
          <div className="field"><label>Fecha</label><input type="date" value={d.fecha || ""} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></div>
          <div className="field"><label>Total (con IVA)</label><input type="number" value={d.total || ""} onChange={(e) => setD({ ...d, total: Number(e.target.value) })} /></div>
        </div>
        <div className="mini">
          Emisor: {d.razon_social_emisor || "—"} {d.rut_emisor ? `(${d.rut_emisor})` : ""} · Receptor: {d.razon_social_receptor || "—"} {d.rut_receptor ? `(${d.rut_receptor})` : ""}
          {d.neto ? ` · Neto ${fmt(d.neto)} · IVA ${fmt(d.iva || 0)}` : ""}{d.referencia_oc ? ` · OC ${d.referencia_oc}` : ""}
        </div>
        <div className="mini" style={{ marginTop: 6 }}>
          {d.tipo === "guia" ? "Se anota la guía en la venta y se habilita el despacho." : d.tipo === "nota_credito" ? "Se guarda el PDF en la venta (la nota de crédito no cambia lo facturado)." : `Se registra como factura de la venta (falta facturar ${fmt(d.falta_facturar)}) y suma al IVA del mes.`} El PDF queda guardado en la venta.
        </div>
      </>}
    </Modal>
  );
}

// Lista de PDFs guardados en la venta
export function DocumentosSII({ venta, notify }) {
  const [docs, setDocs] = useState(null);
  useEffect(() => { api(`/ventas/${venta.id}/sii`).then((d) => setDocs(d.documentos)).catch(() => setDocs([])); }, [venta.id, venta.estado_factura, venta.guia_despacho]);
  if (!docs?.length) return null;
  return (
    <div className="mini" style={{ marginTop: 6 }}>
      Documentos del SII: {docs.map((x) => (
        <button key={x.id} className="link" style={{ marginRight: 8 }} onClick={() => descargar(`/ventas/${venta.id}/documentos/${x.id}`, x.nombre_archivo).catch((e) => notify(e.message, "danger"))}>
          ↓ {TIPOS[x.tipo] || x.tipo} {x.folio}{x.fecha ? ` (${fecha(x.fecha)})` : ""}
        </button>
      ))}
    </div>
  );
}
