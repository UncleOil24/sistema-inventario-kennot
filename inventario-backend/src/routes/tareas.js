// Tareas programadas. Las llama GitHub Actions (ver .github/workflows/tareas.yml) en la tarde y en la mañana.
// Es pública (sin sesión) pero solo hace trabajo cuando corresponde, así que llamarla de más no tiene efecto:
//  - TARDE (desde las 18:00 de Chile): revisa Mercado Público, una vez por tarde
//  - MAÑANA (06:00 a 12:00): envía por correo el resumen de licitaciones nuevas y, una vez por semana, el respaldo
// La hora se calcula en hora de Chile, así funciona igual con horario de verano o de invierno.
const router = require("express").Router();
const { Op } = require("sequelize");
const { getParametros, setParametros } = require("../services/parametros");
const trabajos = require("../services/trabajos");
const mp = require("../services/mercadoPublico");
const Licitacion = require("../models/Licitacion");
const { enviarRespaldo, enviarCorreo, correoConfigurado } = require("../services/respaldo");

let ultimaLlamada = 0;
const horasDesde = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600e3 : Infinity);
const horaChile = () => Number(new Date().toLocaleString("en-US", { timeZone: "America/Santiago", hour: "2-digit", hour12: false })) % 24;

// Licitaciones nuevas (de la región, abiertas, sin revisar) que aún no salieron en un resumen
async function nuevasSinAvisar(params) {
  const filas = await Licitacion.findAll({
    where: { avisada: false, estado_interno: "nueva", [Op.or]: [{ fecha_cierre: null }, { fecha_cierre: { [Op.gte]: new Date() } }] },
    order: [["fecha_cierre", "ASC"]],
  });
  return filas.filter((l) => mp.enRegiones(l.region, params));
}

async function enviarResumenLicitaciones() {
  const params = await getParametros();
  const nuevas = await nuevasSinAvisar(params);
  if (!nuevas.length) return { enviadas: 0 };
  const para = params.respaldo_email || process.env.SMTP_USER;
  const linea = (l) => {
    const cierre = l.fecha_cierre ? new Date(l.fecha_cierre).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sin fecha";
    return `• ${l.codigo} — ${l.nombre}\n  ${l.organismo || ""}${l.comuna ? `, ${l.comuna}` : ""} · cierra ${cierre}${l.items?.length ? ` · ${l.items.length} productos` : ""}\n  https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(l.codigo)}`;
  };
  await enviarCorreo({
    para,
    asunto: `${nuevas.length} licitación(es) nueva(s) en Mercado Público`,
    texto: `Buenos días. Estas son las licitaciones nuevas que calzan con nuestras palabras clave (${params.mp_regiones || "todo Chile"}):\n\n${nuevas.map(linea).join("\n\n")}\n\nRevísalas y cotízalas en el sistema, menú Licitaciones.`,
  });
  await Licitacion.update({ avisada: true }, { where: { codigo: nuevas.map((l) => l.codigo) } });
  return { enviadas: nuevas.length, para };
}

router.all("/", async (req, res) => {
  if (Date.now() - ultimaLlamada < 10 * 60e3) return res.json({ ok: true, data: { omitido: "llamada reciente" } });
  ultimaLlamada = Date.now();
  try {
    const p = await getParametros();
    const hora = horaChile();
    const hecho = { hora_chile: hora };
    // Tarde: revisar Mercado Público (una vez, aunque GitHub llame dos veces)
    if (hora >= 18 && mp.ticketConfigurado() && horasDesde(p.mp_ultima_sincronizacion) >= 4) {
      hecho.mercado_publico = trabajos.iniciar("mercado_publico", (avisar) => mp.sincronizar({ onProgreso: avisar })).id;
    }
    // Mañana: resumen de licitaciones nuevas y respaldo semanal por correo
    if (hora >= 6 && hora < 12 && correoConfigurado()) {
      if (horasDesde(p.ultimo_resumen_licitaciones) >= 12) {
        hecho.resumen = trabajos.iniciar("resumen_licitaciones", async () => {
          const r = await enviarResumenLicitaciones();
          await setParametros({ ultimo_resumen_licitaciones: new Date().toISOString() });
          return r;
        }).id;
      }
      if (horasDesde(p.ultimo_respaldo) >= 6 * 24) hecho.respaldo = trabajos.iniciar("respaldo", () => enviarRespaldo()).id;
    }
    res.json({ ok: true, data: hecho });
  } catch (e) {
    console.error("tareas:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.enviarResumenLicitaciones = enviarResumenLicitaciones;
