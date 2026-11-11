import { useState, useEffect } from "react";
import { api, invalidarProductos, descargar } from "./lib";
import ImportarPlanilla from "./ImportarPlanilla";

export default function Config({ notify }) {
  const [params, setParams] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const [ia, setIa] = useState(null);
  const [resp, setResp] = useState(null);
  const [mpTicket, setMpTicket] = useState(null);
  const [respaldando, setRespaldando] = useState(false);
  const cargarResp = () => api("/respaldo/estado").then(setResp).catch(() => {});
  useEffect(() => {
    api("/parametros").then(setParams).catch((e) => notify(e.message, "danger"));
    api("/ia/estado").then(setIa).catch(() => {});
    cargarResp();
    api("/mercado-publico/licitaciones?vista=descartadas").then((d) => setMpTicket(d.ticket)).catch(() => {});
  }, [notify]);

  const bajarRespaldo = async () => {
    setRespaldando(true);
    try { await descargar("/respaldo/excel", `Respaldo_Kenott_${new Date().toLocaleDateString("sv-SE")}.xlsx`); notify("✓ Respaldo descargado"); }
    catch (e) { notify(e.message, "danger"); }
    finally { setRespaldando(false); }
  };
  const enviarRespaldo = async () => {
    setRespaldando(true);
    try { await api("/parametros", { method: "PUT", body: { respaldo_email: params.respaldo_email || "" } }); const r = await api("/respaldo/enviar", { method: "POST" }); notify(`✓ Respaldo enviado a ${r.para}`); cargarResp(); }
    catch (e) { notify(e.message, "danger"); }
    finally { setRespaldando(false); }
  };

  const guardar = async () => {
    setGuardando(true);
    try { setParams(await api("/parametros", { method: "PUT", body: params })); invalidarProductos(); notify("✓ Parámetros guardados"); }
    catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
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
        <div className="panel-titulo">Finanzas y Control</div>
        {!params ? <span className="mini"><span className="spinner"></span>Cargando...</span> : <>
          <div className="fields-row">
            {campo("saldo_minimo_caja_kenott", "Saldo mínimo de caja Kenott ($)")}
            {campo("saldo_minimo_caja_tactics", "Saldo mínimo de caja Tactics ($)")}
          </div>
          <div className="fields-row">
            {campo("iva_dia_pago", "Día de pago del IVA", "A más tardar este día del mes siguiente; si cae fin de semana pasa al lunes")}
            {campo("margen_minimo", "Margen mínimo (% sobre el neto)", "23,1% equivale a compra × 1,30")}
            {campo("dias_aviso_vencimiento", "Avisar a Comercial antes del vencimiento (días)")}
          </div>
          <div className="fields-row">
            {campo("regimen_kenott", "Régimen tributario Kenott", "", "text")}
            {campo("regimen_tactics", "Régimen tributario Tactics", "", "text")}
          </div>
          <div className="fields-row">
            {campo("iva_desde", "IVA: calcular desde el mes", "Formato AAAA-MM (ej. 2026-10)", "text")}
            {campo("iva_remanente_kenott", "Remanente de crédito fiscal Kenott ($)", "El del último F29 antes de ese mes (lo informa el contador)")}
            {campo("iva_remanente_tactics", "Remanente de crédito fiscal Tactics ($)", "El del último F29 antes de ese mes")}
          </div>
          <div className="fields-row">
            {campo("dias_aviso_pago_proveedor", "Avisar antes de que venza el pago a un proveedor (días)")}
          </div>
        </>}
      </div>
      <div className="panel">
        <div className="panel-titulo">Márgenes y cotizaciones</div>
        {!params ? <span className="mini"><span className="spinner"></span>Cargando...</span> : <>
          <div className="fields-row">
            {campo("margen_convenio", "Margen convenio (%)", `Precio convenio = compra × ${(1 + Number(params.margen_convenio || 0) / 100).toFixed(2).replace(".", ",")}`)}
            {campo("margen_particular", "Margen particular (%)", `Precio particular = compra × ${(1 + Number(params.margen_particular || 0) / 100).toFixed(2).replace(".", ",")}`)}
          </div>
          <div className="fields-row">
            {campo("ultimo_numero_cotizacion", "Último N° de cotización Kenott", "La próxima cotización usa el número siguiente")}
            {campo("validez_cotizacion_dias", "Validez por defecto (días)")}
          </div>
          {campo("plazo_entrega", "Plazo de entrega por defecto", "Se imprime en las condiciones comerciales; se puede cambiar en cada cotización", "text")}
          <div className="fields-row">
            {campo("dias_seguimiento", "Llamar al cliente después de (días)", "Una cotización sin respuesta pasa a \"Por llamar\"")}
            {campo("meses_precio_antiguo", "Precio antiguo después de (meses)", "Se marca ⏱ para volver a cotizarlo")}
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
        <div className="panel-titulo">Datos de Inversiones Kenott (PDF y Excel de la cotización)</div>
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
        <div className="panel-titulo">Datos de Tactics Inversiones (formato propio)</div>
        {!params ? <span className="mini"><span className="spinner"></span>Cargando...</span> : <>
          <div className="mini">Al cotizar eliges "Tactics Inversiones": sale con su logo, firma, formato y numeración. Comparte catálogo, precios y márgenes con Kenott.</div>
          <div className="fields-row">{texto("tactics_nombre", "Razón social")}{texto("tactics_rut", "RUT")}</div>
          {texto("tactics_giro", "Giro")}
          {texto("tactics_direccion", "Dirección")}
          <div className="fields-row">{texto("tactics_contacto", "Contacto")}{texto("tactics_fono", "Teléfono")}</div>
          <div className="fields-row">{texto("tactics_email", "Email")}{texto("tactics_representante", "Representante legal (firma)")}</div>
          <div className="fields-row tres">{texto("tactics_banco", "Banco")}{texto("tactics_tipo_cuenta", "Tipo de cuenta")}{texto("tactics_numero_cuenta", "N° de cuenta")}</div>
          <div className="fields-row tres">{texto("tactics_entrega", "Plazo de entrega")}{texto("tactics_garantia", "Garantía")}{texto("tactics_modalidad", "Modalidad de servicio")}</div>
          {campo("tactics_ultimo_numero_cotizacion", "Último N° de cotización Tactics", "La próxima cotización Tactics usa el número siguiente")}
          <div><button className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar"}</button></div>
        </>}
      </div>

      <div className="panel">
        <div className="panel-titulo">Mercado Público (Compra Ágil y licitaciones)</div>
        {mpTicket === null ? <span className="mini">—</span> : mpTicket
          ? <div className="mini"><span className="estado estado-ok">✓ Conectado</span> Se revisan solas cada tarde a las 18:00 y las nuevas aparecen en el Inicio; si el correo está configurado, llega un resumen cada mañana. También puedes pulsar "Buscar nuevas" en Licitaciones.</div>
          : <div className="aviso" style={{ marginBottom: 0 }}>Falta el ticket. Pídelo gratis en <strong>chilecompra.cl/api</strong> (botón "Pide tu ticket", con Clave Única). Llega por correo; agrégalo en Render → backend → Environment como <strong>MERCADOPUBLICO_TICKET</strong>.</div>}
        {params && <>
          <div className="field">
            <label>Palabras clave (separadas por coma)</label>
            <textarea className="textarea" rows={4} value={params.mp_palabras || ""} onChange={(e) => setParams({ ...params, mp_palabras: e.target.value })} />
            <span className="mini">Licitaciones: se busca cualquiera de estas palabras en el nombre (sin importar tildes). En Compra Ágil se revisan todas las de la región y Claude decide cuáles calzan con el catálogo.</span>
          </div>
          {texto("mp_regiones", "Regiones (separadas por coma; vacío = todo Chile)")}
          <div className="field">
            <label className="check"><input type="checkbox" checked={params.mp_compra_agil !== "0"} onChange={(e) => setParams({ ...params, mp_compra_agil: e.target.checked ? "1" : "0" })} />Revisar también Compra Ágil</label>
          </div>
          {texto("mp_monto_minimo", "Monto mínimo ($): se ignoran los procesos con monto menor")}
          {texto("mp_relevancia_minima", "Calce mínimo con el catálogo (%): lo que Claude puntúa más bajo va a \"Descartadas\"")}
          <div className="field">
            <label>Organismos prioritarios (salen primero con ★; basta una parte del nombre)</label>
            <textarea className="textarea" rows={3} value={params.mp_prioridad || ""} onChange={(e) => setParams({ ...params, mp_prioridad: e.target.value })} />
          </div>
          <div className="field">
            <label>Organismos excluidos (no se muestran)</label>
            <textarea className="textarea" rows={2} value={params.mp_excluir_organismos || ""} onChange={(e) => setParams({ ...params, mp_excluir_organismos: e.target.value })} />
          </div>
          <div className="field">
            <label>Palabras que descartan un proceso (si están en el nombre)</label>
            <textarea className="textarea" rows={3} value={params.mp_excluir_palabras || ""} onChange={(e) => setParams({ ...params, mp_excluir_palabras: e.target.value })} />
            <span className="mini">Lo descartado así queda en Licitaciones → "Descartadas" por si quieres recuperarlo.</span>
          </div>
          <div><button className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar"}</button></div>
        </>}
      </div>

      <div className="panel">
        <div className="panel-titulo">Respaldo</div>
        <div className="mini">Un Excel con toda la información del sistema (productos, precios, clientes, cotizaciones, ventas, compras, gastos).</div>
        <div><button className="btn btn-ghost" disabled={respaldando} onClick={bajarRespaldo}>↓ Descargar respaldo ahora</button></div>
        {resp && (resp.correo ? <>
          <div className="mini"><span className="estado estado-ok">✓ Correo configurado</span> Se envía solo una vez por semana.{resp.ultimo ? ` Último envío: ${new Date(resp.ultimo).toLocaleString("es-CL")}.` : " Aún no se ha enviado."}</div>
          {params && texto("respaldo_email", "Enviar el respaldo a")}
          <div><button className="btn btn-ghost" disabled={respaldando} onClick={enviarRespaldo}>✉ Enviar respaldo ahora</button></div>
        </> : (
          <div className="aviso" style={{ marginBottom: 0 }}>
            Para recibirlo por correo cada semana: en la cuenta de Gmail de la empresa activa la verificación en 2 pasos y crea una
            "contraseña de aplicación". Luego en Render → backend → Environment agrega <strong>SMTP_USER</strong> (el correo) y <strong>SMTP_PASS</strong> (esa contraseña).
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-titulo">Lectura con Claude</div>
        {!ia ? <span className="mini">—</span> : ia.configurada
          ? <div className="mini"><span className="estado estado-ok">✓ Conectado</span> Modelo: {ia.modelo}. Se usa para leer listas de clientes y documentos de proveedores. Cada respuesta queda guardada para auditar.</div>
          : <div className="aviso" style={{ marginBottom: 0 }}>Falta la clave de la API de Anthropic. En Render → servicio del backend → Environment, agrega <strong>ANTHROPIC_API_KEY</strong> con la clave de la empresa (console.anthropic.com) y reinicia el servicio.</div>}
      </div>

      <ImportarPlanilla notify={notify} />
    </div>
  );
}
