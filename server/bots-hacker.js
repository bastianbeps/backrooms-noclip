// Bots TRAMPOSOS para VALIDAR el observatorio: reportan posiciones ilegales a
// propósito para que el validador de sala.js las rechace y suba el contador
// jug.rechazos (vel = speedhack, muro = noclip). Sirven para pintar cómo se
// ve una alerta de seguridad en el panel — NO son código de producción.
//
// Uso: node server/bots-hacker.js [n] [url] [nivel]
//   node server/bots-hacker.js 3 ws://localhost:8099/ws
'use strict';

const WebSocket = require('ws');
const { generarMapa, esTransitable } = require('./sim/mundo');
const Fisica = require('../game/js/sim/fisica');

const N = parseInt(process.argv[2], 10) || 3;
const URL = process.argv[3] || 'ws://localhost:8080/ws';
const NIVEL = process.argv[4] || undefined;

// nombres que gritan «mírame» en el panel
const NOMBRES = ['xX_N0CL1P_Xx', 'SpeedRunner99', 'gh0st_wall', 'TeleKid', 'w4llh4ck'];

let conectados = 0, intentos = 0, rechazos = 0;
const mapas = new Map();
function mapaDe(nivel, semilla) {
  if (!mapas.has(semilla)) mapas.set(semilla, generarMapa(nivel, semilla).map);
  return mapas.get(semilla);
}

// Centro del tile SÓLIDO más cercano (pared/vacío) en anillos crecientes.
function paredMasCercana(map, x, y) {
  const g = map.grid;
  for (let r = 1; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
        if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) continue;
        if (!esTransitable(map, tx, ty)) {
          const cx = tx + 0.5, cy = ty + 0.5;
          return { x: cx, y: cy, dist: Math.hypot(cx - x, cy - y) };
        }
      }
  }
  return null;
}

function bot(i) {
  const ws = new WebSocket(URL);
  const nombre = NOMBRES[(i - 1) % NOMBRES.length];
  // dos estilos de trampa alternos: speedhack puro vs noclip a través de muro
  const modo = i % 2 === 0 ? 'speed' : 'noclip';
  const st = { x: 0, y: 0, rot: Math.PI, sec: 0, map: null, id: null };

  ws.on('open', () => {
    conectados++;
    ws.send(JSON.stringify({ t: 'hola', nombre, token: `hack-${i}`, v: 7, nivel: NIVEL }));
    const paso = setInterval(() => {
      if (ws.readyState !== 1) { clearInterval(paso); return; }
      if (!st.map) return;
      intentos++;
      if (modo === 'speed') {
        // teleport largo en una dirección: Σdist >> vel·dt → rechazo 'vel'
        st.rot = Fisica.normAng(st.rot + 0.4);
        const salto = 8; // tiles de golpe (el tope legal ronda 1.3)
        ws.send(JSON.stringify({
          t: 'p', sec: st.sec,
          x: Math.round((st.x + Math.sin(st.rot) * salto) * 100) / 100,
          y: Math.round((st.y - Math.cos(st.rot) * salto) * 100) / 100,
          rot: Math.round(st.rot * 100) / 100,
        }));
      } else {
        // noclip: acércate ANDANDO a la pared más próxima y, al llegar, reporta
        // un punto DENTRO de ella (salto corto ≤1.3 → pasa velocidad, pero
        // caminoLegal lo caza → rechazo 'muro')
        const pared = paredMasCercana(st.map, st.x, st.y);
        if (pared && pared.dist <= 1.2) {
          // salto CORTO (1.0 tile ≤ tope de velocidad 1.3) que cae dentro del
          // muro → pasa el filtro de velocidad, lo caza caminoLegal = 'muro'
          const ux = (pared.x - st.x) / pared.dist, uy = (pared.y - st.y) / pared.dist;
          const px = st.x + ux * 1.0, py = st.y + uy * 1.0;
          ws.send(JSON.stringify({
            t: 'p', sec: st.sec,
            x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100,
            rot: Math.round(st.rot * 100) / 100,
          }));
        } else if (pared) {
          // camina legal hacia la pared con paso PEQUEÑO (dt bajo): a plena
          // velocidad el tramo superaba 1.3 tiles y el propio andar se
          // rechazaba como 'vel', contaminando la señal de noclip
          st.rot = Math.atan2(pared.x - st.x, -(pared.y - st.y));
          [st.x, st.y] = Fisica.mover(st.map.grid, st.x, st.y,
            Math.sin(st.rot), -Math.cos(st.rot), 0.1, Fisica.VEL_JUGADOR);
          ws.send(JSON.stringify({
            t: 'p', sec: st.sec,
            x: Math.round(st.x * 100) / 100, y: Math.round(st.y * 100) / 100,
            rot: Math.round(st.rot * 100) / 100,
          }));
        }
      }
    }, 400); // más lento que un bot legítimo: el patrón se ve, no satura
  });

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'bienvenida' || m.t === 'nivel') {
      st.id = m.id ?? st.id; st.x = m.x; st.y = m.y;
      st.rot = m.rot ?? Math.PI; st.sec = m.sec ?? 0;
      st.map = mapaDe(m.nivel, m.semilla);
    }
    if (m.t === 'mueve' && m.id === st.id) {
      // el validador lo devolvió a la última posición legal y subió sec
      st.x = m.x; st.y = m.y;
      if (m.sec !== undefined) { st.sec = m.sec; rechazos++; }
    }
  });
  ws.on('error', (e) => console.error(`hacker ${i}:`, e.message));
  ws.on('close', () => { conectados--; });
}

for (let i = 1; i <= N; i++) setTimeout(() => bot(i), i * 40);

setInterval(() => {
  console.log(`hackers: ${conectados}/${N} conectados · ${intentos} intentos ilegales · ${rechazos} rechazados por el servidor`);
  intentos = 0; rechazos = 0;
}, 5000);
