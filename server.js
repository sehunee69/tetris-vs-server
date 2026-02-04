const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); 
});

app.get('/vs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'vs.html'));
});

let waitingPlayer = null;

io.on('connection', (socket) => {
    socket.on('join_queue', () => {
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            const roomID = `room_${waitingPlayer.id}_${socket.id}`;
            const opponent = waitingPlayer;
            waitingPlayer = null;
            socket.join(roomID);
            opponent.join(roomID);
            io.to(roomID).emit('match_found', roomID);
        } else {
            waitingPlayer = socket;
        }
    });

    socket.on('update_state', (data) => {
        socket.to(data.room).emit('opponent_update', data.state);
    });

    socket.on('send_garbage', (data) => {
        socket.to(data.room).emit('receive_garbage', data.lines);
    });

    socket.on('player_game_over', (data) => {
        socket.to(data.room).emit('opponent_game_over');
    });

    // Handle 2-minute timer expiration
    socket.on('player_time_up', (data) => {
        socket.to(data.room).emit('time_expired_sync', data.score);
    });

    socket.on('disconnect', () => {
        if (waitingPlayer === socket) waitingPlayer = null;
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));