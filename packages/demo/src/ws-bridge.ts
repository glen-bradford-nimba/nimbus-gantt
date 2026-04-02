// ─── WebSocket Bridge Server ────────────────────────────────────────────────
// Relays messages between the phone motion controller and the 3D Gantt viewer.
//
// Run with:  npx tsx packages/demo/src/ws-bridge.ts
//
// The phone connects and sends orientation/gesture data.
// The desktop 3D page connects and receives it.
// All messages are relayed to all OTHER connected clients.

import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.WS_PORT || '8765', 10);
const wss = new WebSocketServer({ port: PORT });

const clients = new Set<WebSocket>();

// Track client types for logging
let nextClientId = 1;
const clientIds = new Map<WebSocket, number>();

wss.on('connection', (ws) => {
  const id = nextClientId++;
  clientIds.set(ws, id);
  clients.add(ws);

  console.log(`[+] Client #${id} connected (${clients.size} total)`);

  ws.on('message', (data) => {
    const msg = data.toString();

    // Relay to all other clients
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  ws.on('close', () => {
    const cid = clientIds.get(ws) ?? '?';
    clients.delete(ws);
    clientIds.delete(ws);
    console.log(`[-] Client #${cid} disconnected (${clients.size} total)`);
  });

  ws.on('error', (err) => {
    const cid = clientIds.get(ws) ?? '?';
    console.error(`[!] Client #${cid} error:`, err.message);
  });
});

// ─── Startup banner ─────────────────────────────────────────────────────────

console.log('');
console.log('  ╔══════════════════════════════════════════════════╗');
console.log('  ║       Nimbus Gantt — WebSocket Bridge            ║');
console.log('  ╠══════════════════════════════════════════════════╣');
console.log(`  ║  Listening on ws://localhost:${PORT}               ║`);
console.log('  ║                                                  ║');
console.log('  ║  Desktop:  open gantt3d.html in browser          ║');
console.log('  ║  Phone:    open motion-control-phone.html        ║');
console.log('  ║            ?ws=ws://<YOUR_LAN_IP>:' + PORT + '       ║');
console.log('  ╚══════════════════════════════════════════════════╝');
console.log('');
