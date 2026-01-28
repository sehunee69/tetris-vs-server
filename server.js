const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// 1. Serve static files (css, js, images) from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// 2. FIX: Serve index.html from 'public' when visiting the root '/'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); 
});

// --- SOCKET IO LOGIC ---
let waitingPlayer = null;

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_queue', () => {
        if (waitingPlayer) {
            // Match found!
            const roomID = waitingPlayer.id + '#' + socket.id;
            const opponent = waitingPlayer;
            waitingPlayer = null;

            socket.join(roomID);
            opponent.join(roomID);

            io.to(roomID).emit('match_found', roomID);
            console.log(`Match started in room: ${roomID}`);
        } else {
            waitingPlayer = socket;
            console.log('User waiting for match...');
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

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});