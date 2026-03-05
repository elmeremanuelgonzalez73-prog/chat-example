import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }
  setupPrimary();
} else {
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  // Tabla actualizada: agregamos room y username
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));
  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  io.on('connection', async (socket) => {
    // Nuevo evento: unirse a una sala
    socket.on('join room', async (room) => {
      socket.join(room);
      socket.emit('message', `Te uniste a la sala: ${room}`);

      // Cargar mensajes anteriores de esa sala
      try {
        const rows = await db.all(
          'SELECT username, message FROM messages WHERE room = ? ORDER BY id ASC',
          [room]
        );
        socket.emit('load messages', rows);
      } catch (e) {
        console.error('Error al cargar mensajes:', e);
      }
    });

    // Evento de envío de mensaje (ahora recibe data con room, username y msg)
    socket.on('chat message', async (data, callback) => {
      const { room, username, msg } = data;

      let result;
      try {
        result = await db.run(
          'INSERT INTO messages (room, username, message) VALUES (?, ?, ?)',
          [room, username, msg]
        );
      } catch (e) {
        console.error('Error al guardar mensaje:', e);
        if (callback) callback();
        return;
      }

      // Enviar SOLO a la sala
      io.to(room).emit('chat message', { username, msg });
      if (callback) callback();
    });

    // Recuperación de mensajes perdidos (mantiene tu lógica original)
    if (!socket.recovered) {
      try {
        await db.each(
          'SELECT id, message FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit('chat message', { username: 'Sistema', msg: row.message }, row.id);
          }
        );
      } catch (e) {
        console.error('Error en recuperación:', e);
      }
    }
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}
