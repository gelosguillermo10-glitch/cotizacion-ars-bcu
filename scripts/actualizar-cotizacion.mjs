#!/usr/bin/env node
/**
 * Cotización del peso argentino (ARS) según el Banco Central del Uruguay (BCU).
 *
 * Fuente: servicio web oficial de cotizaciones del BCU (SOAP, público, sin clave):
 *   https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones   (WSDL: ?wsdl)
 *   Moneda 500 = "PESO ARGENTINO" (CodigoISO ARS, grupo 1: arbitrajes internacionales).
 *   TCV/TCC = pesos uruguayos por 1 peso argentino  →  ARS = UYU / uyu_por_ars.
 *
 * Qué hace:
 *   1. Pide al BCU las cotizaciones de los últimos 10 días y toma la más reciente.
 *   2. La valida (número > 0, rango razonable, fecha válida, no más vieja que la guardada,
 *      variación contra la anterior acotada).
 *   3. Si es válida, reescribe cotizacion-ars.json. Si algo falla, CONSERVA la última
 *      cotización válida, registra el error en "estado" y termina con código 1
 *      (GitHub avisa por email del fallo).
 *
 * Sin dependencias: Node 18+ (fetch nativo).
 * Variables opcionales: BCU_FIXTURE=archivo.xml (pruebas sin red), SALIDA=ruta del JSON,
 *                       AHORA=ISO (fecha simulada para pruebas).
 */
import { readFile, writeFile } from 'node:fs/promises';

const ENDPOINT = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones';
const SOAP_ACTION = 'Cotizaaction/AWSBCUCOTIZACIONES.Execute';
const MONEDA_ARS = 500;
const SALIDA = process.env.SALIDA || 'cotizacion-ars.json';
const AHORA = process.env.AHORA ? new Date(process.env.AHORA) : new Date();

// Límites de seguridad (ARS frente a UYU). Fuera de esto se considera un dato erróneo.
const MIN_UYU_POR_ARS = 0.0005;   // 1 UYU = 2.000 ARS
const MAX_UYU_POR_ARS = 0.5;      // 1 UYU = 2 ARS
const MAX_VARIACION = 0.25;       // ±25 % contra la cotización anterior (si es de los últimos 30 días)

function fechaMontevideo(d) {
  // YYYY-MM-DD en America/Montevideo
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function restarDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
function diasEntre(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

function sobreSoap(desde, hasta) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Header/>
  <soapenv:Body>
    <cot:wsbcucotizaciones.Execute>
      <cot:Entrada>
        <cot:Moneda><cot:item>${MONEDA_ARS}</cot:item></cot:Moneda>
        <cot:FechaDesde>${desde}</cot:FechaDesde>
        <cot:FechaHasta>${hasta}</cot:FechaHasta>
        <cot:Grupo>0</cot:Grupo>
      </cot:Entrada>
    </cot:wsbcucotizaciones.Execute>
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function pedirBCU(desde, hasta) {
  if (process.env.BCU_FIXTURE) return readFile(process.env.BCU_FIXTURE, 'utf8');
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: SOAP_ACTION },
        body: sobreSoap(desde, hasta),
        signal: ctrl.signal,
      });
      const texto = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return texto;
    } catch (e) {
      ultimoError = e;
      if (intento < 3) await new Promise((r) => setTimeout(r, intento * 5000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`No se pudo consultar el BCU: ${ultimoError && ultimoError.message}`);
}

const etiqueta = (bloque, nombre) => {
  const m = bloque.match(new RegExp(`<${nombre}(?:\\s[^>]*)?>([^<]*)</${nombre}>`));
  return m ? m[1].trim() : '';
};

export function interpretarRespuesta(xml) {
  if (typeof xml !== 'string' || !xml.includes('respuestastatus')) throw new Error('Respuesta del BCU sin formato reconocible');
  const status = etiqueta(xml, 'status');
  const codigo = etiqueta(xml, 'codigoerror');
  const mensaje = etiqueta(xml, 'mensaje');
  const datos = [...xml.matchAll(/<datoscotizaciones\.dato[^>]*>([\s\S]*?)<\/datoscotizaciones\.dato>/g)].map((m) => ({
    fecha: etiqueta(m[1], 'Fecha'),
    moneda: Number(etiqueta(m[1], 'Moneda')),
    iso: etiqueta(m[1], 'CodigoISO'),
    nombre: etiqueta(m[1], 'Nombre'),
    tcv: Number(etiqueta(m[1], 'TCV')),
    tcc: Number(etiqueta(m[1], 'TCC')),
  }));
  const validos = datos.filter((d) =>
    d.moneda === MONEDA_ARS && d.iso === 'ARS' && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) &&
    Number.isFinite(d.tcv) && d.tcv >= MIN_UYU_POR_ARS && d.tcv <= MAX_UYU_POR_ARS);
  if (!validos.length) {
    throw new Error(`El BCU no devolvió una cotización válida de ARS (status ${status || '?'}, código ${codigo || '?'}${mensaje ? ': ' + mensaje : ''})`);
  }
  validos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return validos[validos.length - 1];
}

async function leerAnterior() {
  try { return JSON.parse(await readFile(SALIDA, 'utf8')); } catch { return null; }
}

function cotizacionValida(c) {
  return c && Number.isFinite(c.uyu_por_ars) && c.uyu_por_ars >= MIN_UYU_POR_ARS && c.uyu_por_ars <= MAX_UYU_POR_ARS &&
    /^\d{4}-\d{2}-\d{2}$/.test(c.fecha_cotizacion || '');
}

async function main() {
  const anterior = await leerAnterior();
  const hoy = fechaMontevideo(AHORA);
  const intento = AHORA.toISOString();
  try {
    const xml = await pedirBCU(restarDias(hoy, 10), hoy);
    const dato = interpretarRespuesta(xml);
    if (dato.fecha > hoy) throw new Error(`Fecha de cotización futura (${dato.fecha})`);

    if (cotizacionValida(anterior)) {
      if (dato.fecha < anterior.fecha_cotizacion) throw new Error(`El BCU devolvió una fecha anterior (${dato.fecha}) a la guardada (${anterior.fecha_cotizacion})`);
      const reciente = diasEntre(anterior.fecha_cotizacion, dato.fecha) <= 30;
      const variacion = Math.abs(dato.tcv / anterior.uyu_por_ars - 1);
      if (reciente && variacion > MAX_VARIACION) {
        throw new Error(`Variación sospechosa (${(variacion * 100).toFixed(1)} %): ${anterior.uyu_por_ars} → ${dato.tcv}. Se conserva la anterior; revisar a mano.`);
      }
    }

    const cambio = !anterior || anterior.uyu_por_ars !== dato.tcv || anterior.fecha_cotizacion !== dato.fecha;
    const salida = {
      moneda: 'ARS',
      base: 'UYU',
      uyu_por_ars: dato.tcv,
      ars_por_uyu: Number((1 / dato.tcv).toFixed(6)),
      formula: 'ARS = UYU / uyu_por_ars',
      fecha_cotizacion: dato.fecha,
      fuente: 'Banco Central del Uruguay (BCU) — servicio web de cotizaciones, moneda 500 "PESO ARGENTINO" (tipo vendedor)',
      fuente_url: ENDPOINT + '?wsdl',
      actualizado: cambio ? intento : (anterior.actualizado || intento),
      estado: { ok: true, ultimo_intento: intento, mensaje: cambio ? 'Cotización actualizada' : 'Sin cambios (el BCU no publicó una cotización nueva)' },
    };
    await writeFile(SALIDA, JSON.stringify(salida, null, 2) + '\n');
    console.log(`OK ${dato.fecha}: 1 ARS = ${dato.tcv} UYU (1 UYU = ${salida.ars_por_uyu} ARS)${cambio ? '' : ' — sin cambios'}`);
  } catch (e) {
    // Conserva la última cotización válida y deja registro del fallo (sin falsificar fechas).
    const base = cotizacionValida(anterior) ? anterior : { moneda: 'ARS', base: 'UYU', uyu_por_ars: null, fecha_cotizacion: null };
    base.estado = { ok: false, ultimo_intento: intento, mensaje: String(e.message || e) };
    await writeFile(SALIDA, JSON.stringify(base, null, 2) + '\n');
    console.error('ERROR:', e.message || e);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
