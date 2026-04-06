import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {}
});

const __dirname = dirname(fileURLToPath(import.meta.url));

// Servir el index.html
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// Base de datos
const db = await open({
  filename: 'chat.db',
  driver: sqlite3.Database
});

await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// Conexión
io.on('connection', (socket) => {

  socket.on('join room', (data) => {
    socket.username = data.username;
    socket.room = data.room || "general";
    socket.join(socket.room);

    // Enviar mensaje de unión
    socket.to(socket.room).emit('user joined', { username: socket.username });
  });

  socket.on('chat message', async (data) => {
    if (!data.message || !data.username) return;

    // Guardar en base de datos
    await db.run(
      'INSERT INTO messages (room, username, message) VALUES (?, ?, ?)',
      [data.room, data.username, data.message]
    );

    // Enviar a todos en la sala
    io.to(data.room).emit('chat message', {
      username: data.username,
      message: data.message
    });
  });

  // Cargar mensajes anteriores al unirse
  socket.on('load messages', async () => {
    const rows = await db.all(
      'SELECT username, message FROM messages WHERE room = ? ORDER BY id ASC',
      [socket.room]
    );
    socket.emit('load messages', rows);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
