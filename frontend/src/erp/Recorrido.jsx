// Acciones del recorrido de una venta (una OC = una venta):
// Operativo acepta y confirma (productos listos) → Comercial factura (una o varias facturas) → Operativo despacha → entregada.
import { useState } from "react";
import { api, fmt, fecha, hoyISO } from "./lib";
import { Recorrido, EstadoFactura, confirmar } from "./ui";
import { FichaSII, SubirSII, DocumentosSII } from "./SII";

// Llama a la API; si el servidor pide confirmación (409), pregunta y reintenta con { forzar: true }
export async function conConfirmacion(url, body = {}, method = "POST") {
  try {
    return await api(url, { method, body });
  } catch (e) {
    if (e.status === 409 && (await confirmar(`${e.message}`, { titulo: "Atención", boton: "Seguir de todas formas" }))) return api(url, { method, body: { ...body, forzar: true } });
    if (e.status === 409) e.cancelado = true;
    throw e;
  }
}

// Paso actual + el botón de lo que toca hacer ahora (según el departamento)
export function AccionesVenta({ venta, puedeOperar, puedeVender, esAdmin, notify, onCambio, abrirCuadro }) {
  const [despacho, setDespacho] = useState(null); // { fecha, guia }
  const [entrega, setEntrega] = useState(null); // { fecha, recibido_por }
  const [enviando, setEnviando] = useState(false);
  if (venta.estado === "anulada") return null;
  const hacer = async (fn, ok) => {
    setEnviando(true);
    try { await fn(); notify(ok); setDespacho(null); setEntrega(null); onCambio(); }
    catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  const c = venta.compras || { ordenes: 0, recibidas: 0 };
  const faltaFactura = venta.estado_factura !== "facturada";

  let contenido = null;
  if (venta.etapa === "registrada") {
    contenido = puedeOperar
      ? <><span>Venta nueva: revísala y acéptala para empezar a comprar.</span>
        <button className="btn btn-primary btn-sm" disabled={enviando} onClick={() => hacer(() => api(`/ventas/${venta.id}/aceptar`, { method: "POST" }), `✓ ${venta.numero} aceptada`)}>✓ Aceptar venta</button>
        {abrirCuadro && <button className="btn btn-ghost btn-sm" onClick={abrirCuadro}>Ver qué comprar</button>}</>
      : <span>Esperando que Operativo la acepte y compre.</span>;
  } else if (venta.etapa === "aceptada") {
    const texto = !c.ordenes ? "Aceptada: falta generar las órdenes de compra." : `Compras: ${c.recibidas} de ${c.ordenes} recibidas.`;
    contenido = puedeOperar
      ? <><span>{texto} Cuando llegue todo, confírmala para que Comercial facture.</span>
        {abrirCuadro && <button className="btn btn-ghost btn-sm" onClick={abrirCuadro}>Cuadro de compra</button>}
        <button className="btn btn-success btn-sm" disabled={enviando} onClick={() => hacer(() => conConfirmacion(`/ventas/${venta.id}/confirmar`), `✓ ${venta.numero} lista: se avisó a Comercial para facturar`)}>✓ Llegaron los productos</button></>
      : <span>En compra ({texto.toLowerCase()})</span>;
  } else if (venta.etapa === "lista") {
    contenido = <>
      <span>Productos listos. {faltaFactura ? "Falta la factura (Comercial)." : "Facturada."}</span>
      {puedeOperar && !despacho && <button className="btn btn-primary btn-sm" onClick={() => setDespacho({ fecha: hoyISO(), guia: "" })}>🚚 Despachar</button>}
      {(puedeOperar || puedeVender) && !entrega && <button className="btn btn-ghost btn-sm" onClick={() => setEntrega({ fecha: hoyISO(), recibido_por: "" })}>Retiró / entregada</button>}
    </>;
  } else if (venta.etapa === "despachada") {
    contenido = <>
      <span>Despachada el {fecha(venta.despacho_fecha)}{venta.guia_despacho ? ` · guía ${venta.guia_despacho}` : ""}.</span>
      {(puedeOperar || puedeVender) && !entrega && <button className="btn btn-success btn-sm" onClick={() => setEntrega({ fecha: hoyISO(), recibido_por: "" })}>✓ El cliente recibió</button>}
    </>;
  } else if (venta.etapa === "entregada") {
    contenido = <span>Entregada el {fecha(venta.entrega_fecha)}{venta.recibido_por ? ` · recibió ${venta.recibido_por}` : ""}.{faltaFactura ? " ⚠ Aún falta facturar." : ""}</span>;
  }

  return (
    <>
      <Recorrido etapa={venta.etapa} />
      <div className="mini" style={{ marginTop: -8, marginBottom: 10 }}>
        {[["Registró", venta.creado_por], ["Aceptó", venta.aceptada_por], ["Confirmó productos", venta.lista_por], ["Despachó", venta.despacho_por]]
          .filter(([, q]) => q).map(([t, q]) => `${t}: ${q}`).join(" · ")}
      </div>
      <div className="accion-etapa">
        {contenido}
        {esAdmin && venta.etapa !== "registrada" && <button className="link" style={{ marginLeft: "auto" }} disabled={enviando}
          onClick={async () => (await confirmar("¿Deshacer el último paso de esta venta?", { titulo: "Deshacer paso", boton: "Deshacer" })) && hacer(() => api(`/ventas/${venta.id}/retroceder`, { method: "POST" }), "Paso deshecho")}>↺ deshacer último paso</button>}
      </div>
      {despacho && (
        <div className="pago-form">
          <input type="date" value={despacho.fecha} onChange={(e) => setDespacho({ ...despacho, fecha: e.target.value })} />
          <input placeholder={(venta.facturas || []).length ? "N° guía de despacho (opcional, ya tiene factura)" : "N° guía de despacho (obligatoria: aún sin factura)"} value={despacho.guia} onChange={(e) => setDespacho({ ...despacho, guia: e.target.value })} />
          <button className="btn btn-primary btn-sm" disabled={enviando} onClick={() => hacer(() => api(`/ventas/${venta.id}/despachar`, { method: "POST", body: despacho }), `✓ ${venta.numero} despachada`)}>Confirmar despacho</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setDespacho(null)}>Cancelar</button>
        </div>
      )}
      {entrega && (
        <div className="pago-form">
          <input type="date" value={entrega.fecha} onChange={(e) => setEntrega({ ...entrega, fecha: e.target.value })} />
          <input placeholder="Quién recibió (opcional)" value={entrega.recibido_por} onChange={(e) => setEntrega({ ...entrega, recibido_por: e.target.value })} />
          {venta.etapa === "lista" && !(venta.facturas || []).length && <input placeholder="N° guía (obligatoria: aún sin factura)" value={entrega.guia || ""} onChange={(e) => setEntrega({ ...entrega, guia: e.target.value })} />}
          <button className="btn btn-success btn-sm" disabled={enviando} onClick={() => hacer(() => api(`/ventas/${venta.id}/entregar`, { method: "POST", body: entrega }), `✓ ${venta.numero} entregada`)}>Confirmar entrega</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEntrega(null)}>Cancelar</button>
        </div>
      )}
    </>
  );
}

// Facturas de la venta: una OC puede tener varias facturas, hasta completar el total
export function PanelFacturas({ venta, puedeVender, notify, onCambio }) {
  const falta = Math.max(0, Math.round(Number(venta.total) - Number(venta.monto_facturado || 0)));
  const [form, setForm] = useState({ numero: "", fecha: hoyISO(), monto: "" });
  const [enviando, setEnviando] = useState(false);
  const facturas = venta.facturas || [];
  const [sii, setSii] = useState(null); // "ficha" | "subir"
  const registrar = async () => {
    setEnviando(true);
    try {
      await conConfirmacion(`/ventas/${venta.id}/facturas`, { ...form, monto: form.monto === "" ? undefined : Number(form.monto) });
      notify(`✓ Factura ${form.numero} registrada`);
      setForm({ numero: "", fecha: hoyISO(), monto: "" });
      onCambio();
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  const quitar = async (f) => {
    if (!(await confirmar(`¿Quitar la factura ${f.numero}?\nSolo si se ingresó por error.`, { titulo: "Quitar factura", boton: "Quitar", peligro: true }))) return;
    try { await api(`/ventas/${venta.id}/facturas/${f.id}`, { method: "DELETE" }); notify("Factura quitada"); onCambio(); }
    catch (e) { notify(e.message, "danger"); }
  };
  return (
    <div className="panel">
      <div className="panel-titulo" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Facturas <EstadoFactura valor={venta.estado_factura} />
        <span className="mini" style={{ marginLeft: "auto" }}>Facturado {fmt(venta.monto_facturado || 0)} de {fmt(venta.total)}{falta > 0 ? ` · falta ${fmt(falta)}` : ""}</span>
      </div>
      {venta.estado !== "anulada" && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setSii("ficha")}>📋 Copiar al SII</button>
          <button className="btn btn-primary btn-sm" onClick={() => setSii("subir")}>⇪ Subir factura / guía del SII</button>
        </div>
      )}
      {sii === "ficha" && <FichaSII venta={venta} notify={notify} onClose={() => setSii(null)} />}
      {sii === "subir" && <SubirSII venta={venta} notify={notify} onClose={() => setSii(null)} onHecho={() => { setSii(null); onCambio(); }} />}
      <DocumentosSII venta={venta} notify={notify} />
      {facturas.length > 0 ? (
        <table className="table table-compacta">
          <tbody>{facturas.map((f) => (
            <tr key={f.id}>
              <td className="id-cell">N° {f.numero}</td><td className="mini">{fecha(f.fecha)}</td>
              <td className="price-cell">{fmt(f.monto)}</td><td className="mini">{f.notas || ""}{f.creado_por ? ` · ${f.creado_por}` : ""}</td>
              <td>{puedeVender && venta.estado !== "anulada" && <button className="btn btn-danger btn-sm" onClick={() => quitar(f)}>✕</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="mini">Sin facturas todavía.</div>}
      {puedeVender && venta.estado !== "anulada" && falta > 0 && (
        <div className="pago-form">
          <input placeholder="N° factura" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
          <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
          <input type="number" placeholder={`Monto con IVA (vacío = ${fmt(falta)})`} value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
          <button className="btn btn-primary btn-sm" disabled={enviando || !form.numero.trim()} onClick={registrar}>+ Registrar factura</button>
        </div>
      )}
    </div>
  );
}
