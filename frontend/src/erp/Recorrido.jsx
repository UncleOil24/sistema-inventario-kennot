// Acciones del recorrido de una venta (una OC = una venta):
// Operativo acepta y confirma (productos listos) → Comercial factura (una o varias facturas) → Operativo despacha → entregada.
import { useState } from "react";
import { api, fmt, fecha, hoyISO } from "./lib";
import { Recorrido, ETAPAS_VENTA, EstadoFactura, confirmar, pedirTexto } from "./ui";
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
export function AccionesVenta({ venta, puedeOperar, notify, onCambio, abrirCuadro }) {
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

  // Cada etapa: qué pasa ahora y el botón para pasar a la siguiente (cuadro grande, bajo su paso del recorrido)
  let texto = null; let botones = null; let progreso = null;
  if (venta.etapa === "registrada") {
    texto = puedeOperar ? "Venta nueva: revísala y acéptala para empezar a comprar." : "Esperando que Operativo la acepte y compre.";
    botones = puedeOperar && <>
      <button className="btn btn-primary btn-grande" disabled={enviando} onClick={() => hacer(() => api(`/ventas/${venta.id}/aceptar`, { method: "POST" }), `✓ ${venta.numero} aceptada`)}>✓ Aceptar venta</button>
      {abrirCuadro && <button className="btn btn-ghost" onClick={abrirCuadro}>Ver qué comprar</button>}</>;
  } else if (venta.etapa === "aceptada") {
    texto = !c.ordenes ? "Falta generar las órdenes de compra (Cuadro de compra)." : `Compras: ${c.recibidas} de ${c.ordenes} recibidas.${puedeOperar ? " Cuando llegue todo, confírmalo para que Comercial facture." : ""}`;
    if (c.ordenes) progreso = Math.round((c.recibidas / c.ordenes) * 100);
    botones = puedeOperar && <>
      <button className="btn btn-success btn-grande" disabled={enviando} onClick={() => hacer(() => conConfirmacion(`/ventas/${venta.id}/confirmar`), `✓ ${venta.numero} lista: se avisó a Comercial para facturar`)}>✓ Llegaron los productos</button>
      {abrirCuadro && <button className="btn btn-ghost" onClick={abrirCuadro}>Cuadro de compra</button>}</>;
  } else if (venta.etapa === "lista") {
    texto = `Productos listos. ${faltaFactura ? "Falta la factura (Comercial)." : "Facturada."}`;
    botones = puedeOperar && <>
      {!despacho && <button className="btn btn-primary btn-grande" onClick={() => setDespacho({ fecha: hoyISO(), guia: "" })}>🚚 Despachar</button>}
      {!entrega && <button className="btn btn-ghost" onClick={() => setEntrega({ fecha: hoyISO(), recibido_por: "" })}>Retiró / entregada</button>}</>;
  } else if (venta.etapa === "despachada") {
    texto = `Despachada el ${fecha(venta.despacho_fecha)}${venta.guia_despacho ? ` · guía ${venta.guia_despacho}` : ""}.`;
    botones = puedeOperar && !entrega && <button className="btn btn-success btn-grande" onClick={() => setEntrega({ fecha: hoyISO(), recibido_por: "" })}>✓ El cliente recibió</button>;
  } else if (venta.etapa === "entregada") {
    texto = `Entregada el ${fecha(venta.entrega_fecha)}${venta.recibido_por ? ` · recibió ${venta.recibido_por}` : ""}.${faltaFactura ? " ⚠ Aún falta facturar." : ""}`;
  }
  const i = Math.max(0, ETAPAS_VENTA.findIndex(([k]) => k === venta.etapa));

  return (
    <>
      <Recorrido etapa={venta.etapa} />
      <div className={`accion-etapa etapa-${venta.etapa}`} style={{ "--flecha": `${(i + 0.5) * 20}%` }}>
        <div className="accion-cabeza">
          <span className="accion-paso">Paso {i + 1} de {ETAPAS_VENTA.length} · {ETAPAS_VENTA[i][1]}</span>
          {puedeOperar && venta.etapa !== "registrada" && <button className="link mini" disabled={enviando}
            onClick={async () => {
              const motivo = await pedirTexto("¿Por qué se deshace el último paso? Queda registrado en el historial de la venta.", { titulo: "Deshacer último paso", placeholder: "Ej.: se marcó despachada por error", obligatorio: true, boton: "Deshacer" });
              if (motivo) hacer(() => api(`/ventas/${venta.id}/retroceder`, { method: "POST", body: { motivo } }), "Paso deshecho (queda en el historial)");
            }}>↺ deshacer último paso</button>}
        </div>
        <div className="accion-texto">{texto}</div>
        {progreso != null && <div className="accion-barra"><span style={{ width: `${progreso}%` }} /></div>}
        {botones && <div className="accion-botones">{botones}</div>}
      </div>
      <div className="mini" style={{ marginTop: -4, marginBottom: 12 }}>
        {[["Registró", venta.creado_por], ["Aceptó", venta.aceptada_por], ["Confirmó productos", venta.lista_por], ["Despachó", venta.despacho_por]]
          .filter(([, q]) => q).map(([t, q]) => `${t}: ${q}`).join(" · ")}
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
  const cerrar = async (abrir) => {
    const ok = abrir || await confirmar(`La venta tiene facturado ${fmt(venta.monto_facturado || 0)} de ${fmt(venta.total)}.\n¿La(s) factura(s) cubren toda la venta? Quedará como Facturada y saldrá de "Facturas por emitir".`, { titulo: "Dar por facturada", boton: "Sí, está facturada" });
    if (!ok) return;
    try { await api(`/ventas/${venta.id}/facturas/cerrar`, { method: "POST", body: { abrir } }); notify(abrir ? "Facturación reabierta" : "✓ Venta facturada"); onCambio(); }
    catch (e) { notify(e.message, "danger"); }
  };
  const quitar = async (f) => {
    const motivo = await pedirTexto(`¿Por qué se quita la factura ${f.numero}? Queda registrado y se avisa a gerencia.`, { titulo: "Quitar factura", placeholder: "Ej.: se anuló con nota de crédito / N° mal escrito", obligatorio: true, boton: "Quitar", peligro: true });
    if (!motivo) return;
    try { await api(`/ventas/${venta.id}/facturas/${f.id}?motivo=${encodeURIComponent(motivo)}`, { method: "DELETE", body: { motivo } }); notify("Factura quitada (queda en el historial)"); onCambio(); }
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
      {puedeVender && venta.estado !== "anulada" && falta > 0 && facturas.length > 0 && (
        <div className="aviso" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          Falta {fmt(falta)} por facturar. Si la factura ya cubre toda la venta (por ejemplo, se anotó el neto o cambió algún precio):
          <button className="btn btn-success btn-sm" onClick={() => cerrar(false)}>✓ Dar por facturada</button>
        </div>
      )}
      {puedeVender && venta.factura_cerrada && falta > 0 && <div className="mini">Dada por facturada con {fmt(venta.monto_facturado)} de {fmt(venta.total)}. <button className="btn btn-ghost btn-sm" onClick={() => cerrar(true)}>Reabrir</button></div>}
      {puedeVender && venta.estado !== "anulada" && falta > 0 && !venta.factura_cerrada && (
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

// Historial de la venta: cada paso, quién y cuándo; los retrocesos y facturas quitadas con su motivo
const ICONO = { paso: "•", factura: "🧾", retroceso: "↺", factura_quitada: "✕", anulacion: "⛔" };
export function HistorialVenta({ venta }) {
  const [abierto, setAbierto] = useState(false);
  const h = venta.historial || [];
  const alertas = h.filter((x) => ["retroceso", "factura_quitada", "anulacion"].includes(x.tipo)).length;
  return (
    <div className="panel">
      <div className="panel-titulo clickable" onClick={() => setAbierto(!abierto)} style={{ cursor: "pointer" }}>
        {abierto ? "▾" : "▸"} Historial ({h.length + 1}){alertas ? <span className="badge-alerta"> · {alertas} corrección(es)</span> : null}
      </div>
      {abierto && (
        <table className="table table-compacta"><tbody>
          <tr><td className="mini">{fecha(venta.createdAt || venta.fecha)}</td><td>• Registró la venta</td><td className="mini">{venta.creado_por || ""}</td></tr>
          {h.map((x) => (
            <tr key={x.id} className={["retroceso", "factura_quitada", "anulacion"].includes(x.tipo) ? "fila-alerta" : ""}>
              <td className="mini">{new Date(x.createdAt).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
              <td>{ICONO[x.tipo] || "•"} {x.texto}{x.motivo && <div className="mini">Motivo: {x.motivo}</div>}</td>
              <td className="mini">{x.por || ""}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}
