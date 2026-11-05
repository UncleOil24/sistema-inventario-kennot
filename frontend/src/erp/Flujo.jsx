// Facturación (Comercial) y Despachos (Operativo): las ventas según la etapa en que están.
import { useState, useEffect, useCallback } from "react";
import { api, fmt, fecha } from "./lib";
import { Modal, Etapa, EstadoFactura, Estado } from "./ui";
import { AccionesVenta, PanelFacturas } from "./Recorrido";

// Ficha corta de la venta para actuar sin salir de la lista
function VentaRapida({ id, puedeOperar, puedeVender, esAdmin, notify, onClose, onCambio, verVenta }) {
  const [venta, setVenta] = useState(null);
  const cargar = useCallback(() => api(`/ventas/${id}`).then(setVenta).catch((e) => notify(e.message, "danger")), [id, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  const cambio = () => { cargar(); onCambio(); };
  return (
    <Modal titulo={`// Venta ${venta?.numero || ""}`} onClose={onClose} ancho={760}
      footer={<>
        <button className="btn btn-ghost" onClick={() => { onClose(); verVenta(id); }}>Ver venta completa</button>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      {!venta ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div> : <>
        <div className="hist-meta">
          <span>{venta.cliente_nombre || "Sin cliente"}</span>
          {venta.orden_compra_cliente && <span>OC {venta.orden_compra_cliente}</span>}
          {venta.id_solicitud && <span className="id-solicitud">ID {venta.id_solicitud}</span>}
          <span>{fecha(venta.fecha)}</span><span>Total {fmt(venta.total)}</span>
          <Estado valor={venta.empresa || "kenott"} />
        </div>
        <AccionesVenta venta={venta} puedeOperar={puedeOperar} puedeVender={puedeVender} esAdmin={esAdmin} notify={notify} onCambio={cambio} />
        <PanelFacturas venta={venta} puedeVender={puedeVender} notify={notify} onCambio={cambio} />
        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead>
            <tbody>{venta.items.map((i, k) => <tr key={k}><td>{i.nombre}</td><td className="mini">{i.cantidad} {i.unidad}</td><td className="price-cell">{fmt(i.precio * i.cantidad)}</td></tr>)}</tbody>
          </table>
        </div>
      </>}
    </Modal>
  );
}

function useVentas(query, notify) {
  const [ventas, setVentas] = useState(null);
  const cargar = useCallback(() => api(`/ventas?estado=emitida&${query}`).then(setVentas).catch((e) => notify(e.message, "danger")), [query, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  return [ventas, cargar];
}

const TablaVentas = ({ ventas, columnas, onAbrir, boton, vacio }) => (
  <div className="table-wrap">
    <table className="table">
      <thead><tr><th>N°</th><th>Cliente</th><th>OC / ID</th><th>Etapa</th>{columnas.map(([t]) => <th key={t}>{t}</th>)}<th></th></tr></thead>
      <tbody>
        {!ventas ? <tr className="empty-row"><td colSpan={9}><span className="spinner"></span>Cargando...</td></tr>
          : ventas.length === 0 ? <tr className="empty-row"><td colSpan={9}>{vacio}</td></tr>
          : ventas.map((v) => (
            <tr key={v.id} className="clickable" onClick={() => onAbrir(v.id)}>
              <td className="id-cell">{v.numero}{v.empresa === "tactics" && <div><Estado valor="tactics" /></div>}</td>
              <td>{v.cliente_nombre || <span className="mini">Sin cliente</span>}</td>
              <td className="mini">{v.orden_compra_cliente || "—"}{v.id_solicitud && <div className="id-solicitud">ID {v.id_solicitud}</div>}</td>
              <td><Etapa valor={v.etapa} /></td>
              {columnas.map(([t, f]) => <td key={t}>{f(v)}</td>)}
              <td><button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onAbrir(v.id); }}>{boton}</button></td>
            </tr>
          ))}
      </tbody>
    </table>
  </div>
);

// --- Facturación (Comercial): ventas con productos listos que falta facturar ---
// Abre la venta pedida desde otra vista (p.ej. una tarea de Inicio)
function useAbrir(abrirId, onAbierta, setAbierta) {
  useEffect(() => { if (abrirId) { setAbierta(abrirId); onAbierta?.(); } }, [abrirId, onAbierta, setAbierta]);
}

export function Facturacion({ notify, esAdmin, verVenta, abrirId, onAbierta }) {
  const [vista, setVista] = useState("pendientes");
  const [abierta, setAbierta] = useState(null);
  useAbrir(abrirId, onAbierta, setAbierta);
  const [pendientes, recargarP] = useVentas("etapa=lista,despachada,entregada&estado_factura=sin_factura,parcial", notify);
  const [enCompra, recargarC] = useVentas("etapa=registrada,aceptada", notify);
  const [facturas, setFacturas] = useState(null);
  const cargarFacturas = useCallback(() => api("/ventas/facturas/lista").then(setFacturas).catch((e) => notify(e.message, "danger")), [notify]);
  useEffect(() => { if (vista === "emitidas") cargarFacturas(); }, [vista, cargarFacturas]);
  const recargar = () => { recargarP(); recargarC(); if (vista === "emitidas") cargarFacturas(); };
  const falta = (v) => Number(v.total) - Number(v.monto_facturado || 0);

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Por facturar</div><div className="stat-value">{pendientes?.length ?? "…"}</div></div>
        <div className="stat-card"><div className="stat-label">Monto por facturar</div><div className="stat-value accent">{fmt((pendientes || []).reduce((s, v) => s + falta(v), 0))}</div></div>
        <div className="stat-card"><div className="stat-label">Aún en compra</div><div className="stat-value">{enCompra?.length ?? "…"}</div></div>
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${vista === "pendientes" ? "activo" : ""}`} onClick={() => setVista("pendientes")}>Por facturar{pendientes?.length ? <strong>{pendientes.length}</strong> : null}</button>
        <button className={`chip ${vista === "compra" ? "activo" : ""}`} onClick={() => setVista("compra")}>En compra (Operativo)</button>
        <button className={`chip ${vista === "emitidas" ? "activo" : ""}`} onClick={() => setVista("emitidas")}>Facturas emitidas</button>
      </div>
      {vista === "pendientes" && <>
        <div className="mini" style={{ marginBottom: 10 }}>Ventas que Operativo confirmó con los productos listos. Una OC puede llevar varias facturas: registra cada una hasta completar el total.</div>
        <TablaVentas ventas={pendientes} onAbrir={setAbierta} boton="Facturar" vacio="// nada por facturar"
          columnas={[["Factura", (v) => <><EstadoFactura valor={v.estado_factura} />{v.documento && <div className="mini">{v.documento}</div>}</>],
            ["Total", (v) => <span className="price-cell">{fmt(v.total)}</span>], ["Falta", (v) => <strong>{fmt(falta(v))}</strong>]]} />
      </>}
      {vista === "compra" && <>
        <div className="mini" style={{ marginBottom: 10 }}>Ventas que Operativo todavía está comprando. Pasan a "Por facturar" cuando confirme que llegaron los productos.</div>
        <TablaVentas ventas={enCompra} onAbrir={setAbierta} boton="Ver" vacio="// ninguna en compra"
          columnas={[["Compras", (v) => <span className="mini">{!v.compras?.ordenes ? "sin órdenes aún" : `${v.compras.recibidas}/${v.compras.ordenes} recibidas`}</span>], ["Total", (v) => <span className="price-cell">{fmt(v.total)}</span>]]} />
      </>}
      {vista === "emitidas" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Factura</th><th>Fecha</th><th>Venta</th><th>Cliente</th><th>OC / ID</th><th>Monto</th></tr></thead>
            <tbody>
              {!facturas ? <tr className="empty-row"><td colSpan={6}><span className="spinner"></span>Cargando...</td></tr>
                : facturas.length === 0 ? <tr className="empty-row"><td colSpan={6}>// sin facturas registradas</td></tr>
                : facturas.map((f) => (
                  <tr key={f.id} className="clickable" onClick={() => f.venta && setAbierta(f.venta.id)}>
                    <td className="id-cell">N° {f.numero}</td>
                    <td className="mini">{fecha(f.fecha)}</td>
                    <td className="id-cell">{f.venta?.numero || "—"}</td>
                    <td>{f.venta?.cliente_nombre || "—"}</td>
                    <td className="mini">{f.venta?.orden_compra_cliente || "—"}{f.venta?.id_solicitud && <div className="id-solicitud">ID {f.venta.id_solicitud}</div>}</td>
                    <td className="price-cell">{fmt(f.monto)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {abierta && <VentaRapida id={abierta} puedeOperar={false} puedeVender esAdmin={esAdmin} notify={notify} onClose={() => setAbierta(null)} onCambio={recargar} verVenta={verVenta} />}
    </>
  );
}

// --- Despachos (Operativo): productos listos por despachar y despachos por confirmar ---
export function Despachos({ notify, esAdmin, verVenta, abrirId, onAbierta }) {
  const [vista, setVista] = useState("lista");
  const [abierta, setAbierta] = useState(null);
  useAbrir(abrirId, onAbierta, setAbierta);
  const [porDespachar, r1] = useVentas("etapa=lista", notify);
  const [enCamino, r2] = useVentas("etapa=despachada", notify);
  const [entregadas, r3] = useVentas("etapa=entregada", notify);
  const recargar = () => { r1(); r2(); r3(); };
  const factura = ["Factura", (v) => <EstadoFactura valor={v.estado_factura} />];

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Por despachar</div><div className="stat-value">{porDespachar?.length ?? "…"}</div></div>
        <div className="stat-card"><div className="stat-label">Despachadas sin confirmar</div><div className="stat-value">{enCamino?.length ?? "…"}</div></div>
        <div className="stat-card"><div className="stat-label">Entregadas</div><div className="stat-value">{entregadas?.length ?? "…"}</div></div>
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${vista === "lista" ? "activo" : ""}`} onClick={() => setVista("lista")}>Por despachar{porDespachar?.length ? <strong>{porDespachar.length}</strong> : null}</button>
        <button className={`chip ${vista === "despachada" ? "activo" : ""}`} onClick={() => setVista("despachada")}>Despachadas</button>
        <button className={`chip ${vista === "entregada" ? "activo" : ""}`} onClick={() => setVista("entregada")}>Entregadas</button>
      </div>
      {vista === "lista" && <TablaVentas ventas={porDespachar} onAbrir={setAbierta} boton="Despachar" vacio="// nada por despachar"
        columnas={[factura, ["Listos desde", (v) => <span className="mini">{fecha(v.lista_fecha)}</span>]]} />}
      {vista === "despachada" && <TablaVentas ventas={enCamino} onAbrir={setAbierta} boton="Confirmar entrega" vacio="// sin despachos en camino"
        columnas={[factura, ["Despacho", (v) => <span className="mini">{fecha(v.despacho_fecha)}{v.guia_despacho ? ` · guía ${v.guia_despacho}` : ""}</span>]]} />}
      {vista === "entregada" && <TablaVentas ventas={entregadas} onAbrir={setAbierta} boton="Ver" vacio="// sin entregas"
        columnas={[factura, ["Entrega", (v) => <span className="mini">{fecha(v.entrega_fecha)}{v.recibido_por ? ` · ${v.recibido_por}` : ""}</span>]]} />}
      {abierta && <VentaRapida id={abierta} puedeOperar puedeVender={false} esAdmin={esAdmin} notify={notify} onClose={() => setAbierta(null)} onCambio={recargar} verVenta={verVenta} />}
    </>
  );
}
