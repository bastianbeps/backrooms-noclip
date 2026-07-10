// Flota de demostración para el OBSERVATORIO: reparte jugadores por varios
// niveles (buenos) y mezcla unos cuantos maliciosos (speedhack y noclip) para
// que el panel muestre chat por nivel, seeds/instancias pobladas y alertas de
// seguridad de ambos tipos. Requiere el servidor con MMO_DEV=1 (para elegir
// nivel al conectar). NO es código de producción.
//
// Uso: node server/simular-flota.js [url]
//   node server/simular-flota.js ws://localhost:8099/ws
'use strict';

const WebSocket = require('ws');
const { generarMapa, esTransitable } = require('./sim/mundo');
const Fisica = require('../game/js/sim/fisica');

const URL = process.argv[2] || 'ws://localhost:8099/ws';
const FRASES = [
  'hola?', '¿alguien más oye el zumbido?', 'por aquí hay una grieta',
  'seguidme', 'me pierdo', 'este pasillo no estaba antes', 'corred',
  'llevo horas caminando', 'qué es ESO', 'las luces parpadean',
  'cuidado con esa entidad', 'tengo sed', 'encontré un objeto',
];

// reparto: [nivel, nº de buenos] — 20 buenos en 6 niveles distintos
const REPARTO = [
  ['level-0', 6], ['level-1', 4], ['the-hub', 4],
  ['level-2', 3], ['level-188', 2], ['level-6', 1],
];
// maliciosos: nivel + tipo de trampa
const MALICIOSOS = [
  { nivel: 'level-0', tipo: 'speed', nombre: 'SpeedRunner99' },
  { nivel: 'level-1', tipo: 'speed', nombre: 'TeleKid' },
  { nivel: 'level-0', tipo: 'noclip', nombre: 'xX_N0CL1P_Xx' },
  { nivel: 'the-hub', tipo: 'noclip', nombre: 'gh0st_wall' },
];

const mapas = new Map();
function mapaDe(nivel, semilla) {
  if (!mapas.has(semilla)) mapas.set(semilla, generarMapa(nivel, semilla).map);
  return mapas.get(semilla);
}

function paredMasCercana(map, x, y) {
  const g = map.grid;
  for (let r = 1; r < 40; r++)
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
  return null;
}

const cont = { buenos: 0, malos: 0, informes: 0, chats: 0, rechazos: 0 };

// bot BUENO: física real, chatea de vez en cuando (para el chat por nivel)
function bueno(nombre, token, nivel) {
  const ws = new WebSocket(URL);
  const st = { x: 0, y: 0, rot: Math.PI, sec: 0, map: null, id: null };
  let giro = 0;
  ws.on('open', () => {
    cont.buenos++;
    ws.send(JSON.stringify({ t: 'hola', nombre, token, v: 7, nivel }));
    const paso = setInterval(() => {
      if (ws.readyState !== 1) { clearInterval(paso); return; }
      if (!st.map) return;
      if (Math.random() < 0.12) giro = [-1, 0, 0, 1][Math.floor(Math.random() * 4)];
      const dt = 0.12;
      st.rot = Fisica.normAng(st.rot + giro * Fisica.GIRO_JUGADOR * dt);
      if (Math.random() >= 0.06)
        [st.x, st.y] = Fisica.mover(st.map.grid, st.x, st.y, Math.sin(st.rot), -Math.cos(st.rot), dt, Fisica.VEL_JUGADOR);
      ws.send(JSON.stringify({ t: 'p', x: r2(st.x), y: r2(st.y), rot: r2(st.rot), sec: st.sec }));
      cont.informes++;
      if (Math.random() < 0.03) { // chatean bastante para poblar la estadística
        ws.send(JSON.stringify({ t: 'chat', txt: FRASES[Math.floor(Math.random() * FRASES.length)] }));
        cont.chats++;
      }
    }, 120);
  });
  ws.on('message', (raw) => rxComun(raw, st));
  ws.on('error', () => {});
  ws.on('close', () => { cont.buenos--; });
}

// bot MALICIOSO: reporta posiciones ilegales; el validador las rechaza
function malo(nombre, token, nivel, tipo) {
  const ws = new WebSocket(URL);
  const st = { x: 0, y: 0, rot: Math.PI, sec: 0, map: null, id: null };
  ws.on('open', () => {
    cont.malos++;
    ws.send(JSON.stringify({ t: 'hola', nombre, token, v: 7, nivel }));
    const paso = setInterval(() => {
      if (ws.readyState !== 1) { clearInterval(paso); return; }
      if (!st.map) return;
      if (tipo === 'speed') {
        st.rot = Fisica.normAng(st.rot + 0.4);
        const s = 8;
        ws.send(JSON.stringify({ t: 'p', sec: st.sec, x: r2(st.x + Math.sin(st.rot) * s), y: r2(st.y - Math.cos(st.rot) * s), rot: r2(st.rot) }));
      } else {
        const p = paredMasCercana(st.map, st.x, st.y);
        if (p && p.dist <= 1.2) {
          const ux = (p.x - st.x) / p.dist, uy = (p.y - st.y) / p.dist;
          ws.send(JSON.stringify({ t: 'p', sec: st.sec, x: r2(st.x + ux * 1.0), y: r2(st.y + uy * 1.0), rot: r2(st.rot) }));
        } else if (p) {
          st.rot = Math.atan2(p.x - st.x, -(p.y - st.y));
          [st.x, st.y] = Fisica.mover(st.map.grid, st.x, st.y, Math.sin(st.rot), -Math.cos(st.rot), 0.1, Fisica.VEL_JUGADOR);
          ws.send(JSON.stringify({ t: 'p', sec: st.sec, x: r2(st.x), y: r2(st.y), rot: r2(st.rot) }));
        }
      }
    }, 350);
  });
  ws.on('message', (raw) => rxComun(raw, st));
  ws.on('error', () => {});
  ws.on('close', () => { cont.malos--; });
}

function rxComun(raw, st) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (m.t === 'bienvenida' || m.t === 'nivel') {
    st.id = m.id ?? st.id; st.x = m.x; st.y = m.y;
    st.rot = m.rot ?? Math.PI; st.sec = m.sec ?? 0;
    st.map = mapaDe(m.nivel, m.semilla);
  }
  if (m.t === 'mueve' && m.id === st.id) {
    st.x = m.x; st.y = m.y;
    if (m.sec !== undefined) { st.sec = m.sec; cont.rechazos++; }
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

// lanzamiento escalonado
let d = 0, idx = 0;
for (const [nivel, n] of REPARTO)
  for (let k = 0; k < n; k++) {
    const i = ++idx;
    setTimeout(() => bueno(`Errante-${i}`, `sim-buen-${i}`, nivel), d += 30);
  }
MALICIOSOS.forEach((m, j) => setTimeout(() => malo(m.nombre, `sim-mal-${j}`, m.nivel, m.tipo), d += 50));

console.log(`flota → ${URL}: 20 buenos en ${REPARTO.length} niveles + ${MALICIOSOS.length} maliciosos (2 speed, 2 noclip)`);
setInterval(() => {
  console.log(`buenos:${cont.buenos} malos:${cont.malos} · ${cont.informes} informes · ${cont.chats} chats · ${cont.rechazos} rechazos`);
  cont.informes = 0; cont.chats = 0; cont.rechazos = 0;
}, 5000);
