// Parámetros editables desde Configuración. Los márgenes NO van escritos en el código.
const Parametro = require("../models/Parametro");

const DEFAULTS = {
  margen_convenio: "30",          // % sobre el precio de compra
  margen_particular: "50",        // % sobre el precio de compra
  ultimo_numero_cotizacion: "0",  // la próxima cotización usa el siguiente número
  validez_cotizacion_dias: "30",
  meses_precio_antiguo: "6",        // un precio más viejo que esto se marca para volver a cotizar
  dias_seguimiento: "5",            // días sin respuesta para llamar al cliente
  respaldo_email: "",               // a dónde llega el respaldo semanal
  ultimo_respaldo: "",
  mp_palabras: "ferreteria, materiales de construccion, materiales construccion, cemento, pintura, gasfiteria, electricidad, electrico, herramientas, maderas, madera, fierro, mantencion, mantenimiento, reparacion, aseo y ornato, articulos de ferreteria, insumos de construccion, candados, cerrajeria, tuberia, pvc, ceramica, sanitario",
  mp_regiones: "Maule",             // separadas por coma; vacío = todo Chile
  mp_compra_agil: "1",              // revisar también Compra Ágil (además de licitaciones)
  mp_monto_minimo: "1000000",
  mp_relevancia_minima: "65",       // % de calce con el catálogo (Claude) para mostrar un proceso       // se ignoran procesos con monto informado menor a esto
  // Organismos que van primero (basta con una parte del nombre, sin tildes)
  mp_prioridad: "municipalidad de yerbas buenas, municipalidad de linares, municipalidad de san javier, municipalidad de curico, municipalidad de longavi, ejercito, regimiento, gendarmeria, carabineros, universidad de talca, universidad catolica del maule, gobierno regional del maule, serviu, vialidad, direccion de arquitectura, delegacion presidencial",
  mp_excluir_organismos: "municipalidad de talca",
  // Si el NOMBRE del proceso tiene alguna de estas, se descarta sola (se puede recuperar en "Descartadas")
  mp_excluir_palabras: "multiparametro, equipo medico, equipos medicos, insumos medicos, insumos clinicos, medicamento, farmaco, dental, odontolog, laboratorio clinico, alimento, alimentacion, colacion, pasaje, alojamiento, hospedaje, capacitacion, curso, consultoria, asesoria, publicidad, arriendo de vehiculo, transporte de pasajeros, combustible, coffee, banqueteria",
  mp_ca_ultima: "",                 // última revisión de Compra Ágil (para pedir solo lo nuevo)
  mp_ultima_sincronizacion: "",
  ultimo_resumen_licitaciones: "",
  // Datos de la empresa para el PDF de la cotización
  empresa_nombre: "INVERSIONES KENOTT SpA",
  empresa_rut: "78.060.315-1",
  empresa_giro: "Comercialización y Distribución de Productos",
  empresa_contacto: "Marcela Espinosa",
  empresa_fono: "+56 9 4709 6606",
  empresa_email: "kenottinversiones@gmail.com",
  responsable_nombre: "Nicol Orellana",
  responsable_cargo: "Jefa Departamento de Ventas",
  representante_nombre: "Marcela Tapia Espinosa",
  banco: "BCI",
  tipo_cuenta: "Cuenta Corriente en Pesos",
  numero_cuenta: "97527637",
  texto_agradecimiento: "Agradecemos sinceramente la oportunidad de presentar esta cotización y quedamos a su disposición para atender cualquier consulta técnica o comercial relacionada con los productos y servicios ofertados.",
};

const getParametros = async (t) => {
  const filas = await Parametro.findAll({ transaction: t });
  const p = { ...DEFAULTS };
  filas.forEach((f) => { p[f.clave] = f.valor; });
  return p;
};

const setParametros = async (cambios, t) => {
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!(clave in DEFAULTS)) continue;
    await Parametro.upsert({ clave, valor: String(valor) }, { transaction: t });
  }
  return getParametros(t);
};

// Precio de venta según tipo de cliente: compra x (1 + margen%)
const precioVenta = (compra, tipo, params) => {
  const c = Number(compra) || 0;
  if (!c) return 0;
  const pct = Number(tipo === "particular" ? params.margen_particular : params.margen_convenio) || 0;
  return Math.round(c * (1 + pct / 100));
};

module.exports = { DEFAULTS, getParametros, setParametros, precioVenta };
