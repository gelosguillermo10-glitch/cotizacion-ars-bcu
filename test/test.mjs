// Pruebas del actualizador sin red: node test/test.mjs
// bcu-ok-2026-10-09.xml reproduce la respuesta real del BCU del 12/10/2026.
// Los demás fixtures son SIMULADOS (errores, saltos y una fecha futura) solo para probar el comportamiento.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'actualizar-cotizacion.mjs');
const fx = (n) => join(here, 'fixtures', n);
const dir = mkdtempSync(join(tmpdir(), 'cot-'));
const out = join(dir, 'cotizacion-ars.json');
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? `  [${info}]` : '')); };
function run(fixture, ahora = '2026-10-12T14:00:00Z') {
  try {
    execFileSync('node', [script], { env: { ...process.env, BCU_FIXTURE: fx(fixture), SALIDA: out, AHORA: ahora }, stdio: 'pipe' });
    return 0;
  } catch (e) { return e.status; }
}
const read = () => JSON.parse(readFileSync(out, 'utf8'));

// 1. Respuesta real: toma la fecha más reciente y la dirección correcta
let code = run('bcu-ok-2026-10-09.xml');
let j = read();
check('respuesta real → sale con código 0', code === 0, code);
check('toma la cotización más reciente (2026-10-09)', j.fecha_cotizacion === '2026-10-09', j.fecha_cotizacion);
check('uyu_por_ars = TCV del BCU (0.026506)', j.uyu_por_ars === 0.026506, j.uyu_por_ars);
check('ars_por_uyu = 1 / 0.026506', Math.abs(j.ars_por_uyu - 1 / 0.026506) < 1e-5, j.ars_por_uyu);
check('ejemplo: 3.490 UYU → 131.668 ARS (sin redondeo)', Math.round(3490 / j.uyu_por_ars) === 131668, Math.round(3490 / j.uyu_por_ars));
check('estado ok y fecha de actualización registrada', j.estado.ok === true && /^2026-10-12T14:00/.test(j.actualizado));
const actualizado1 = j.actualizado;

// 2. Misma respuesta más tarde → sin cambios, no se falsifica "actualizado"
code = run('bcu-ok-2026-10-09.xml', '2026-10-12T22:30:00Z');
j = read();
check('sin dato nuevo → conserva "actualizado" original', code === 0 && j.actualizado === actualizado1, j.actualizado);
check('registra el último intento', j.estado.ultimo_intento === '2026-10-12T22:30:00.000Z');

// 3. Día sin cotización (respuesta real de error del BCU: TCV 0) → conserva la anterior, código 1
code = run('bcu-sin-cotizacion.xml', '2026-10-13T13:30:00Z');
j = read();
check('BCU sin cotización → código 1 (GitHub avisa)', code === 1, code);
check('conserva la última cotización válida', j.uyu_por_ars === 0.026506 && j.fecha_cotizacion === '2026-10-09');
check('no falsifica la fecha de actualización', j.actualizado === actualizado1, j.actualizado);
check('estado.ok=false con el mensaje del BCU', j.estado.ok === false && /No existe cotización/.test(j.estado.mensaje), j.estado.mensaje);
check('nunca guarda 0 como cotización', j.uyu_por_ars > 0);

// 4. Respuesta no SOAP (caída / HTML)
code = run('bcu-html-error.xml', '2026-10-13T14:00:00Z');
j = read();
check('respuesta inválida → código 1 y conserva la anterior', code === 1 && j.uyu_por_ars === 0.026506, `${code} ${j.uyu_por_ars}`);

// 5. Salto sospechoso (simulado) → se rechaza
code = run('bcu-salto-sospechoso.xml', '2026-10-13T22:30:00Z');
j = read();
check('variación > 25 % → rechazada, conserva la anterior', code === 1 && j.uyu_por_ars === 0.026506 && /Variación sospechosa/.test(j.estado.mensaje), j.estado.mensaje);

// 6. Nueva cotización (simulada) → se actualiza
code = run('bcu-nueva-2026-10-13.xml', '2026-10-13T23:00:00Z');
j = read();
check('nueva cotización → se actualiza fecha y valor', code === 0 && j.fecha_cotizacion === '2026-10-13' && j.uyu_por_ars === 0.0266, `${j.fecha_cotizacion} ${j.uyu_por_ars}`);
check('"actualizado" = momento de la actualización', j.actualizado === '2026-10-13T23:00:00.000Z', j.actualizado);

// 7. Fecha que retrocede → se rechaza
code = run('bcu-ok-2026-10-09.xml', '2026-10-14T13:30:00Z');
j = read();
check('fecha anterior a la guardada → rechazada', code === 1 && j.fecha_cotizacion === '2026-10-13', j.estado.mensaje);

// 8. Fecha futura → se rechaza (reloj simulado antes de la cotización)
writeFileSync(out, '{}');
code = run('bcu-nueva-2026-10-13.xml', '2026-10-12T12:00:00Z');
j = read();
check('cotización con fecha futura → rechazada', code === 1 && j.estado.ok === false, j.estado && j.estado.mensaje);

// 9. Primer arranque con error → JSON sin cotización (el tema desactiva la conversión)
writeFileSync(out, '{}');
code = run('bcu-sin-cotizacion.xml');
j = read();
check('sin cotización previa + error → uyu_por_ars null (conversión desactivada)', code === 1 && j.uyu_por_ars === null && j.fecha_cotizacion === null);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
