import { useState, useEffect } from "react";
import { Modal, Estado, Etapa, EstadoFactura, confirmar } from "./ui";
import { api, fmt, fecha, nombreCot, sinTildes } from "./lib";

const VACIO = {
  codigo: "", nombre: "", organismo: "", rut: "", tipo: "convenio", empresa: "ambas",
  contacto: "", telefono: "", email: "", comuna: "", direccion: "",
  plazo_pago_dias: 30, base_vencimiento: "factura", contacto_finanzas: "", limite_credito: "", estado_credito: "activo", usa_factoring: false, notas: "",
};
const EMPRESAS = [["ambas", "Ambas"], ["kenott", "Kenott"], ["tactics", "Tactics"]];
const plazoTxt = (c) => (Number(c.plazo_pago_dias) === 0 ? "Contado" : `${c.plazo_pago_dias ?? 30} días${c.base_vencimiento === "recepcion" ? " desde recepción" : ""}`);

export default function Clientes({ esAdmin, clientes, loading, recargar, notify }) {
  const [form, setForm] = useState(null);
  const [ficha, setFicha] = useState(null); // id del cliente abierto
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState("");

  const lista = clientes.filter((c) => {
    const q = sinTildes(busqueda);
    return (!tipo || c.tipo === tipo)
      && (!q || [c.codigo, c.nombre, c.organismo, c.rut, c.comuna, c.contacto].some((v) => sinTildes(v || "").includes(q)));
  });

  const guardar = async () => {
    if (!form.nombre?.trim()) return notify("El nombre es obligatorio", "danger");
    setGuardando(true);
    try {
      if (form.id) await api(`/clientes/${form.id}`, { method: "PUT", body: form });
      else await api("/clientes", { method: "POST", body: form });
      notify(form.id ? "✓ Cliente actualizado" : "✓ Cliente agregado");
      setForm(null);
      recargar();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  const eliminar = async (c) => {
    if (!(await confirmar(`¿Eliminar a ${c.nombre}?\nSus cotizaciones y ventas se conservan.`, { titulo: "Eliminar cliente", boton: "Eliminar", peligro: true }))) return;
    try { await api(`/clientes/${c.id}`, { method: "DELETE" }); notify("Cliente eliminado", "danger"); recargar(); }
    catch (e) { notify(e.message, "danger"); }
  };
  const campo = (k, label, ph, extra = {}) => (
    <div className="field" style={extra.style}>
      <label>{label}</label>
      <input type={extra.type || "text"} value={form[k] ?? ""} disabled={extra.disabled} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={ph} />
      {extra.ayuda && <span className="mini">{extra.ayuda}</span>}
    </div>
  );

  return (
    <>
      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por ID, nombre, institución, RUT, comuna o contacto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="chips">
          {[["", "Todos"], ["convenio", "Instituciones"], ["particular", "Particulares"]].map(([v, t]) => <button key={t} className={`chip ${tipo === v ? "activo" : ""}`} onClick={() => setTipo(v)}>{t}</button>)}
        </div>
        <div className="mini">{lista.length} de {clientes.length}</div>
        <button className="btn btn-primary" onClick={() => setForm({ ...VACIO })}>+ Nuevo cliente</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>ID</th><th>Nombre</th><th>Tipo de precio</th><th>Plazo de pago</th><th>Empresa</th><th>Contacto</th><th>Comuna</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={8}><span className="spinner"></span>Cargando...</td></tr>
              : lista.length === 0 ? <tr className="empty-row"><td colSpan={8}>// sin clientes</td></tr>
              : lista.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setFicha(c.id)}>
                  <td className="id-cell">{c.codigo || "—"}</td>
                  <td style={{ fontWeight: 500 }}>
                    {c.nombre}
                    {c.organismo && c.organismo !== c.nombre && <div className="mini">{c.organismo}</div>}
                    {c.codigo === "P-001" && <div className="mini">Ventas sueltas: el nombre se escribe en cada cotización</div>}
                  </td>
                  <td><Estado valor={c.tipo || "convenio"} /></td>
                  <td className="mini">{plazoTxt(c)}{c.estado_credito === "suspendido" && <div><span className="estado estado-warn">Crédito suspendido</span></div>}</td>
                  <td className="mini">{EMPRESAS.find(([v]) => v === (c.empresa || "ambas"))?.[1]}</td>
                  <td className="mini">{c.contacto || "—"}{c.telefono && <div>{c.telefono}</div>}</td>
                  <td className="mini">{c.comuna || "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}><div className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setFicha(c.id)}>Ficha</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...VACIO, ...c, limite_credito: c.limite_credito ?? "" })}>Editar</button>
                    {esAdmin && c.codigo !== "P-001" && <button className="btn btn-danger btn-sm" onClick={() => eliminar(c)}>✕</button>}
                  </div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal titulo={form.id ? `// Editar cliente ${form.codigo || ""}` : "// Nuevo cliente"} onClose={() => setForm(null)} ancho={720}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</button>
          </>}>
          <div className="panel-titulo">Identificación</div>
          <div className="fields-row">
            {campo("codigo", "ID del cliente", "Automático: P-001", { style: { maxWidth: 190 }, disabled: form.codigo === "P-001" && !!form.id })}
            {campo("nombre", "Nombre o razón social", "Ej: Municipalidad de Talca – Salud", { disabled: form.codigo === "P-001" && !!form.id })}
          </div>
          <div className="mini" style={{ marginTop: -6, marginBottom: 10 }}>Instituciones: su unidad de compra de Mercado Público (Ej: 1422 = CONAF; 2295 = Municipalidad de Talca compras generales; 2292 = Municipalidad de Talca Salud). Vacío = se asigna P-001, P-002...</div>
          <div className="fields-row">
            {campo("organismo", "Institución (si tiene varias unidades de compra)", "Ej: Municipalidad de Talca")}
            {campo("rut", "RUT", "69.000.000-0", { style: { maxWidth: 180 } })}
          </div>
          <div className="fields-row">
            <div className="field">
              <label>Tipo de precio</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                <option value="convenio">Institución (convenio)</option>
                <option value="particular">Particular</option>
              </select>
            </div>
            <div className="field">
              <label>Lo atiende</label>
              <select value={form.empresa || "ambas"} onChange={(e) => setForm({ ...form, empresa: e.target.value })}>
                {EMPRESAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="panel-titulo" style={{ marginTop: 8 }}>Contacto</div>
          <div className="fields-row">{campo("contacto", "Contacto", "Nombre de quien compra")}{campo("telefono", "Teléfono", "+569...")}</div>
          <div className="fields-row">{campo("email", "Email", "correo@...")}{campo("comuna", "Comuna", "Talca")}</div>
          {campo("direccion", "Dirección", "Calle, ciudad")}

          <div className="panel-titulo" style={{ marginTop: 8 }}>Cobranza</div>
          <div className="fields-row">
            {campo("plazo_pago_dias", "Plazo de pago (días)", "30", { type: "number", ayuda: "0 = contado. Se copia a cada venta y se puede cambiar en ella." })}
            <div className="field">
              <label>El plazo se cuenta desde</label>
              <select value={form.base_vencimiento || "factura"} onChange={(e) => setForm({ ...form, base_vencimiento: e.target.value })}>
                <option value="factura">La factura</option>
                <option value="recepcion">La recepción conforme</option>
              </select>
            </div>
          </div>
          {campo("contacto_finanzas", "Contacto de finanzas (para cobrar)", "Ej: Tesorería · tesoreria@...")}
          <label className="check" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={!!form.usa_factoring} onChange={(e) => setForm({ ...form, usa_factoring: e.target.checked })} />
            A veces sus facturas se ceden a factoring (ej. Ejército de Chile, Linares)
          </label>
          {form.estado_credito === "suspendido" && form.motivo_credito && <div className="aviso">Crédito suspendido: {form.motivo_credito}</div>}
          {esAdmin && (
            <div className="fields-row">
              {campo("limite_credito", "Límite de crédito ($, opcional)", "Sin límite", { type: "number" })}
              <div className="field">
                <label>Crédito</label>
                <select value={form.estado_credito || "activo"} onChange={(e) => setForm({ ...form, estado_credito: e.target.value })}>
                  <option value="activo">Activo</option>
                  <option value="suspendido">Suspendido (avisa al venderle)</option>
                </select>
              </div>
            </div>
          )}
          <div className="field">
            <label>Notas</label>
            <textarea className="textarea" rows={2} value={form.notas || ""} onChange={(e) => setForm({ ...form, notas: e.target.value })} placeholder="Ej: pide la factura con N° de OC en la glosa" />
          </div>
        </Modal>
      )}
      {ficha && <FichaCliente id={ficha} esAdmin={esAdmin} notify={notify} onClose={() => setFicha(null)}
        onEditar={(c) => { setFicha(null); setForm({ ...VACIO, ...c, limite_credito: c.limite_credito ?? "" }); }} />}
    </>
  );
}

// Todo lo del cliente en un lugar: datos, lo cotizado, lo vendido y lo que debe
function FichaCliente({ id, esAdmin, notify, onClose, onEditar }) {
  const [d, setD] = useState(null);
  useEffect(() => { api(`/clientes/${id}/ficha`).then(setD).catch((e) => notify(e.message, "danger")); }, [id, notify]);
  const c = d?.cliente;
  const r = d?.resumen;
  return (
    <Modal titulo={`// ${c ? `${c.codigo || ""} · ${c.nombre}` : "Cliente"}`} onClose={onClose} ancho={860}
      footer={<>
        {c && <button className="btn btn-ghost" onClick={() => onEditar(c)}>Editar</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      {!d ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div> : <>
        <div className="hist-meta">
          {c.organismo && <span>{c.organismo}</span>}
          {c.rut && <span>RUT {c.rut}</span>}
          <Estado valor={c.tipo} />
          <span>Plazo de pago: {plazoTxt(c)}</span>
          {c.contacto && <span>{c.contacto}{c.telefono ? ` · ${c.telefono}` : ""}</span>}
          {c.contacto_finanzas && <span>Finanzas: {c.contacto_finanzas}</span>}
          {c.estado_credito === "suspendido" && <span className="estado estado-warn">Crédito suspendido</span>}
        </div>
        {c.notas && <div className="aviso">{c.notas}</div>}
        <div className="stats">
          <div className="stat-card"><div className="stat-label">Cotizaciones</div><div className="stat-value">{r.cotizaciones}</div><div className="mini">{r.ganadas} ganadas</div></div>
          <div className="stat-card"><div className="stat-label">Vendido (con IVA)</div><div className="stat-value accent">{fmt(r.vendido)}</div><div className="mini">{r.ventas} venta(s)</div></div>
          <div className="stat-card"><div className="stat-label">Saldo por cobrar</div><div className="stat-value" style={{ color: r.vencido > 0 ? "var(--danger)" : undefined }}>{fmt(r.por_cobrar)}</div>
            <div className="mini">{r.vencido > 0 ? `${fmt(r.vencido)} vencido` : "nada vencido"}{r.sobre_limite ? " · sobre el límite" : ""}</div></div>
          <div className="stat-card"><div className="stat-label">Paga con atraso de</div><div className="stat-value">{r.atraso_promedio == null ? "—" : `${r.atraso_promedio} d`}</div><div className="mini">promedio, sobre su plazo</div></div>
        </div>
        <div className="panel-titulo">Ventas</div>
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table className="table table-compacta">
            <thead><tr><th>N°</th><th>Fecha</th><th>OC / ID</th><th>Etapa</th><th>Factura</th><th>Total</th>{esAdmin && <th>Saldo</th>}{esAdmin && <th>Vence</th>}</tr></thead>
            <tbody>
              {d.ventas.length === 0 ? <tr className="empty-row"><td colSpan={8}>// sin ventas</td></tr> : d.ventas.map((v) => (
                <tr key={v.id} className={v.estado === "anulada" ? "fila-anulada" : ""}>
                  <td className="id-cell">{v.numero}</td><td className="mini">{fecha(v.fecha)}</td>
                  <td className="mini">{v.orden_compra_cliente || "—"}{v.id_solicitud && <div className="id-solicitud">ID {v.id_solicitud}</div>}</td>
                  <td>{v.estado === "anulada" ? <Estado valor="anulada" /> : <Etapa valor={v.etapa} />}</td>
                  <td className="mini"><EstadoFactura valor={v.estado_factura} />{v.documento && <div>{v.documento}</div>}</td>
                  <td className="price-cell">{fmt(v.total)}</td>
                  {esAdmin && <td className="price-cell">{fmt(Number(v.total) - Number(v.monto_pagado))}</td>}
                  {esAdmin && <td className="mini">{fecha(v.fecha_vencimiento)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-titulo">Cotizaciones</div>
        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr><th>Cotización</th><th>Fecha</th><th>ID</th><th>Descripción</th><th>Estado</th><th>Total</th></tr></thead>
            <tbody>
              {d.cotizaciones.length === 0 ? <tr className="empty-row"><td colSpan={6}>// sin cotizaciones</td></tr> : d.cotizaciones.map((q) => (
                <tr key={q.id}>
                  <td className="id-cell">{nombreCot(q)}</td><td className="mini">{fecha(q.fecha)}</td>
                  <td className="mini">{q.id_solicitud || "—"}</td><td className="mini">{q.nombre_cotizacion || ""}</td>
                  <td><Estado valor={q.estado} /></td><td className="price-cell">{fmt(q.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </Modal>
  );
}
