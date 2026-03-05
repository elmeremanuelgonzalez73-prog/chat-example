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

  // Tabla modificada para guardar también el room
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

  io.on('connection', (socket) => {
    socket.on('join room', (room) => {
      socket.join(room);
      socket.emit('message', `Te uniste a la sala: ${room}`);

      // Cargar mensajes anteriores de esa sala
      db.all('SELECT username, message FROM messages WHERE room = ? ORDER BY id ASC', [room], (err, rows) => {
        if (!err) {
          socket.emit('load messages', rows);
        }
      });
    });

    socket.on('chat message', async (data) => {
      const { room, username, msg } = data;

      // Guardar en la base
      await db.run(
        'INSERT INTO messages (room, username, message) VALUES (?, ?, ?)',
        [room, username, msg]
      );

      // Enviar solo a la sala
      io.to(room).emit('chat message', { username, msg });
    });
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}
