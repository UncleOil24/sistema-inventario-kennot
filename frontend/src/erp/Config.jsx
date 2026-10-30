import { useState, useEffect } from "react";
import { api, authFetch, API_URL, invalidarProductos } from "./lib";

export default function Config({ notify }) {
  const [params, setParams] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const [desactivar, setDesactivar] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const [ia, setIa] = useState(null);
  useEffect(() => {
    api("/parametros").then(setParams).catch((e) => notify(e.message, "danger"));
    api("/ia/estado").then(setIa).catch(() => {});
  }, [notify]);

  const guardar = async () => {
    setGuardando(true);
    try { setParams(await api("/parametros", { method: "PUT", body: params })); invalidarProductos(); notify("✓ Parámetros guardados"); }
    catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  const [avance, setAvance] = useState(null);

  // Consulta el avance de una importación en segundo plano hasta que termine
  const seguir = async (id) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      let t;
      try { t = await api(`/precios/importar-planilla/${id}`); }
      catch (e) { notify(e.message, "danger"); setImportando(false); setAvance(null); return; }
      setAvance(t);
      if (t.estado === "listo") { setResultado(t.resumen); invalidarProductos(); notify("✓ Planilla importada"); break; }
      if (t.estado === "error") { notify(`Error al importar: ${t.error}`, "danger"); break; }
    }
    setImportando(false);
  };

  const importar = async () => {
    if (!archivo) return;
    if (!confirm("La importación reemplaza el precio vigente, opciones y REVISAR de cada producto de la planilla. El historial de precios no se duplica. ¿Continuar?")) return;
    setImportando(true);
    setResultado(null);
    setAvance({ estado: "corriendo", paso: "Subiendo el archivo...", segundos: 0 });
    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      if (desactivar) fd.append("desactivar_otros", "1");
      const res = await authFetch(`${API_URL}/api/precios/importar-planilla`, { method: "POST", body: fd });
      const data = await res.json();
      // Si ya había una importación corriendo, se sigue esa
      if (res.status === 409 && data.data?.id) { notify(data.error, "danger"); return seguir(data.data.id); }
      if (!data.ok) throw new Error(data.error || "Error al importar");
      await seguir(data.data.id);
    } catch (e) { notify(e.message, "danger"); setImportando(false); setAvance(null); }
  };

  const campo = (k, label, ayuda, tipo = "number") => (
    <div className="field">
      <label>{label}</label>
      <input type={tipo} value={params[k] ?? ""} onChange={(e) => setParams({ ...params, [k]: e.target.value })} />
      {ayuda && <span className="mini">{ayuda}</span>}
    </div>
  );
  const texto = (k, label) => campo(k, label, null, "text");

  return (
    <div className="dash-grid">
      <div className="panel">
        <div className="panel-titulo">Márgenes y cotizaciones</div>
        {!params ? <span className="mini"><span className="spinner"></span>Cargando...</span> : <>
          <div className="fields-row">
            {campo("margen_convenio", "Margen convenio (%)", `Precio convenio = compra × ${(1 + Number(params.margen_convenio || 0) / 100).toFixed(2).replace(".", ",")}`)}
            {campo("margen_particular", "Margen particular (%)", `Precio particular = compra × ${(1 + Number(params.margen_particular || 0) / 100).toFixed(2).replace(".", ",")}`)}
          </div>
          <div className="fields-row">
            {campo("ultimo_numero_cotizacion", "Último N° de cotización usado", "La próxima cotización usa el número siguiente")}
            {campo("validez_cotizacion_dias", "Validez por defecto (días)")}
          </div>
          <div className="mini">
            Margen sobre la venta: convenio {Math.round((Number(params.margen_convenio) / (100 + Number(params.margen_convenio))) * 100)}% ·
            particular {Math.round((Number(params.margen_particular) / (100 + Number(params.margen_particular))) * 100)}% (antes de gastos).
            Las cotizaciones ya guardadas no cambian.
          </div>
          <div><button className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar"}</button></div>
        </>}
      </div>

      <div className="panel">
        <div className="panel-titulo">Datos de la empresa (PDF de la cotización)</div>
        {!params ? <span className="mini"><span className="spinner"></span>Cargando...</span> : <>
          <div className="fields-row">{texto("empresa_nombre", "Razón social")}{texto("empresa_rut", "RUT")}</div>
          {texto("empresa_giro", "Giro")}
          <div className="fields-row">{texto("empresa_contacto", "Contacto")}{texto("empresa_fono", "Teléfono")}</div>
          {texto("empresa_email", "Email")}
          <div className="fields-row">{texto("responsable_nombre", "Responsable comercial")}{texto("responsable_cargo", "Cargo")}</div>
          {texto("representante_nombre", "Representante legal (firma)")}
          <div className="fields-row">{texto("banco", "Banco")}{texto("tipo_cuenta", "Tipo de cuenta")}</div>
          {texto("numero_cuenta", "N° de cuenta")}
          <div className="field">
            <label>Texto de agradecimiento</label>
            <textarea className="textarea" rows={3} value={params.texto_agradecimiento || ""} onChange={(e) => setParams({ ...params, texto_agradecimiento: e.target.value })} />
          </div>
          <div><button className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar"}</button></div>
        </>}
      </div>

      <div className="panel">
        <div className="panel-titulo">Lectura con Claude</div>
        {!ia ? <span className="mini">—</span> : ia.configurada
          ? <div className="mini"><span className="estado estado-ok">✓ Conectado</span> Modelo: {ia.modelo}. Se usa para leer listas de clientes y documentos de proveedores. Cada respuesta queda guardada para auditar.</div>
          : <div className="aviso" style={{ marginBottom: 0 }}>Falta la clave de la API de Anthropic. En Render → servicio del backend → Environment, agrega <strong>ANTHROPIC_API_KEY</strong> con la clave de la empresa (console.anthropic.com) y reinicia el servicio.</div>}
      </div>

      <div className="panel">
        <div className="panel-titulo">Importar planilla LISTADO_CONSOLIDADO</div>
        <div className="mini">
          Carga el .xlsx (v61 o posterior). Lee las hojas LISTADO CONSOLIDADO (productos, precio vigente, opciones 2 y 3, REVISAR, confirmados),
          COTIZACIONES y EXTRAS PROVEEDORES (historial de precios), los contactos de proveedores y el REGISTRO DE CAMBIOS.
          Se puede volver a importar: no duplica precios.
        </div>
        <input type="file" accept=".xlsx" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        <label className="check">
          <input type="checkbox" checked={desactivar} onChange={(e) => setDesactivar(e.target.checked)} />
          Desactivar los productos que no están en la planilla (no se borran)
        </label>
        <div><button className="btn btn-primary" disabled={!archivo || importando} onClick={importar}>{importando ? <><span className="spinner"></span>Importando...</> : "Importar"}</button></div>
        {avance && avance.estado !== "listo" && (
          <div className={avance.estado === "error" ? "login-error" : "aviso"} style={{ marginBottom: 0 }}>
            {avance.estado === "error" ? `Error: ${avance.error}` : <><span className="spinner"></span>{avance.paso} ({avance.segundos || 0} s)</>}
          </div>
        )}
        {resultado && avance?.segundos != null && <div className="mini">Terminó en {avance.segundos} segundos.</div>}
        {resultado && (
          <table className="table table-compacta">
            <tbody>
              {[
                ["Productos en la planilla", resultado.productos_en_planilla],
                ["Nuevos / actualizados", `${resultado.productos_nuevos} / ${resultado.productos_actualizados}`],
                ["Con precio / confirmados", `${resultado.con_precio} / ${resultado.confirmados}`],
                ["Precios agregados al historial", resultado.precios_agregados],
                ["Precios descartados (más baratos no aplicados en la planilla)", resultado.precios_descartados],
                ["Proveedores nuevos", resultado.proveedores_nuevos],
                ["Registro de cambios importado", resultado.registro_cambios],
                resultado.desactivados ? ["Productos desactivados", resultado.desactivados] : ["Productos fuera de la planilla", resultado.fuera_de_planilla],
              ].map(([k, v]) => <tr key={k}><td className="mini">{k}</td><td className="price-cell">{v}</td></tr>)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
