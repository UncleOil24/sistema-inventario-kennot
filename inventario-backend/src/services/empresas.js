// Empresas con las que se cotiza y vende: Kenott (principal) y Tactics Inversiones.
// Comparten catálogo, precios y márgenes; cada una tiene sus datos, su numeración de cotizaciones y su formato.
const path = require("path");

const EMPRESAS = ["kenott", "tactics"];
const PLANTILLAS = path.join(__dirname, "../../plantillas");

const validarEmpresa = (e) => (EMPRESAS.includes(e) ? e : "kenott");

// Datos de la empresa con nombres comunes, a partir de los parámetros
function datosEmpresa(clave, p) {
  if (clave === "tactics") {
    return {
      clave, nombre: p.tactics_nombre, corto: "Tactics", rut: p.tactics_rut, giro: p.tactics_giro, direccion: p.tactics_direccion,
      contacto: p.tactics_contacto, email: p.tactics_email, fono: p.tactics_fono, representante: p.tactics_representante,
      responsable: p.tactics_contacto, cargo: "Representante Legal",
      banco: p.tactics_banco, tipo_cuenta: p.tactics_tipo_cuenta, numero_cuenta: p.tactics_numero_cuenta,
      entrega: p.tactics_entrega, garantia: p.tactics_garantia, modalidad: p.tactics_modalidad,
      ultimo_numero: p.tactics_ultimo_numero_cotizacion,
      logo: path.join(PLANTILLAS, "logo_tactics.png"), firma: path.join(PLANTILLAS, "firma_tactics.png"),
    };
  }
  return {
    clave: "kenott", nombre: p.empresa_nombre, corto: "Kenott", rut: p.empresa_rut, giro: p.empresa_giro, direccion: "",
    contacto: p.empresa_contacto, email: p.empresa_email, fono: p.empresa_fono, representante: p.representante_nombre,
    responsable: p.responsable_nombre, cargo: p.responsable_cargo,
    banco: p.banco, tipo_cuenta: p.tipo_cuenta, numero_cuenta: p.numero_cuenta,
    ultimo_numero: p.ultimo_numero_cotizacion,
    logo: path.join(PLANTILLAS, "logo_kenott.png"), firma: path.join(PLANTILLAS, "firma.png"),
  };
}

module.exports = { EMPRESAS, validarEmpresa, datosEmpresa };
