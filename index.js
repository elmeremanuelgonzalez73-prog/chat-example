import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
const server = createServer(app);
const io = new Server(server);

const __dirname = dirname(fileURLToPath(import.meta.url));

// Servir el index.html
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// Base de datos para que los mensajes NO se borren
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

io.on('connection', (socket) => {

  // Cuando alguien entra a una sala
  socket.on('join room', async (data) => {
    socket.username = data.username;
    socket.room = data.room || "general";
    socket.join(socket.room);

    // Cargar mensajes anteriores de esa sala
    const history = await db.all(
      'SELECT username, message FROM messages WHERE room = ? ORDER BY id ASC',
      [socket.room]
    );
    socket.emit('load messages', history);   // ← Esto carga el historial
  });

  // Cuando alguien envía un mensaje
  socket.on('chat message', async (data) => {
    if (!data.message || !data.username) return;

    // Guardar el mensaje en la base de datos (persistencia)
    await db.run(
      'INSERT INTO messages (room, username, message) VALUES (?, ?, ?)',
      [data.room, data.username, data.message]
    );

    // Enviar el mensaje a todos en la misma sala
    io.to(data.room).emit('chat message', {
      username: data.username,
      message: data.message
    });
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
