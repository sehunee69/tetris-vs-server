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


// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

let waitingPlayer = null;

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_queue', () => {
        if (waitingPlayer) {
            // Match found!
            const opponent = waitingPlayer;
            waitingPlayer = null;

            // Create a unique room ID
            const roomId = opponent.id + '#' + socket.id;
            
            // Join both to the room
            socket.join(roomId);
            opponent.join(roomId);

            // Notify both players
            io.to(roomId).emit('match_found', roomId);
            
            // Assign roles
            socket.emit('start_game', { role: 'player2', opponentId: opponent.id });
            opponent.emit('start_game', { role: 'player1', opponentId: socket.id });

            console.log(`Match started: ${opponent.id} vs ${socket.id}`);
        } else {
            // No one waiting, put this socket in queue
            waitingPlayer = socket;
            socket.emit('waiting_for_match');
            console.log(`User ${socket.id} is waiting...`);
        }
    });

    // Relay Game State (Movement, Board Updates)
    socket.on('update_state', (data) => {
        socket.to(data.room).emit('opponent_update', data.state);
    });

    // Handle Attack (Garbage Lines)
    socket.on('send_garbage', (data) => {
        socket.to(data.room).emit('receive_garbage', data.lines);
    });

    // Handle Game Over
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
    console.log(`Server running on http://localhost:${PORT}`);
});