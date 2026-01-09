const socket = io();

// --- DOM ELEMENTS ---
const canvasLocal = document.getElementById('local');
const ctxLocal = canvasLocal.getContext('2d');
const canvasRemote = document.getElementById('remote');
const ctxRemote = canvasRemote.getContext('2d');
const waitingScreen = document.getElementById('waiting-screen');
const countdownScreen = document.getElementById('countdown-screen');
const countdownText = document.getElementById('countdown-text');
const resultScreen = document.getElementById('result-screen');
const resultTitle = document.getElementById('result-title');
const scoreElement = document.getElementById('score');

// Scale canvases
ctxLocal.scale(25, 25);  // Slightly smaller scale to fit two boards
ctxRemote.scale(25, 25);

// --- GAME CONSTANTS ---
const colors = [null, '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#4b5563']; // Added grey for garbage

// --- STATE ---
let roomID = null;
let gameActive = false;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;

// Player State
const player = {
    pos: {x: 0, y: 0},
    matrix: null,
    score: 0,
    arena: createMatrix(12, 24), // 24 height to accommodate garbage
};

// Opponent State (We only render this)
const opponent = {
    matrix: null, // Current falling piece (optional to render)
    pos: {x:0, y:0},
    arena: createMatrix(12, 24),
};

// --- SOCKET.IO EVENTS ---

// 1. Connection & Queue
socket.emit('join_queue');

// 2. Match Found -> Countdown
socket.on('match_found', (id) => {
    roomID = id;
    waitingScreen.style.display = 'none';
    startCountdown();
});

// 3. Receive Opponent Updates
socket.on('opponent_update', (state) => {
    // state contains: arena, pos, matrix (active piece)
    opponent.arena = state.arena;
    opponent.pos = state.pos;
    opponent.matrix = state.matrix;
    drawRemote(); // Redraw opponent board immediately
});

// 4. Receive Garbage (Attack)
socket.on('receive_garbage', (linesCount) => {
    // Add gray lines to the bottom
    for (let i = 0; i < linesCount; i++) {
        const grayRow = new Array(12).fill(8); // 8 is grey color index
        // Make one random hole so it's possible to clear
        grayRow[Math.floor(Math.random() * 12)] = 0;
        player.arena.push(grayRow);
        player.arena.shift(); // Remove top line (game over check usually happens here)
    }
    // Shake effect (optional)
    canvasLocal.style.transform = "translateX(5px)";
    setTimeout(() => canvasLocal.style.transform = "none", 50);
});

// 5. Game Over Handling
socket.on('opponent_game_over', () => {
    gameActive = false;
    resultTitle.innerText = "YOU WIN!";
    resultTitle.classList.add('text-green-500');
    resultScreen.classList.remove('hidden');
});


// --- GAME LOGIC ---

function startCountdown() {
    countdownScreen.style.display = 'flex';
    let count = 3;
    
    // Play sound (if you integrated the audioCtx from previous step)
    // playSound('start'); 

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownText.innerText = count;
        } else if (count === 0) {
            countdownText.innerText = "GO!";
        } else {
            clearInterval(interval);
            countdownScreen.style.display = 'none';
            gameActive = true;
            playerReset();
            update();
        }
    }, 1000);
}

function createMatrix(w, h) {
    const matrix = [];
    while (h--) matrix.push(new Array(w).fill(0));
    return matrix;
}

function createPiece(type) {
    if (type === 'I') return [[0, 1, 0, 0],[0, 1, 0, 0],[0, 1, 0, 0],[0, 1, 0, 0]];
    if (type === 'L') return [[0, 2, 0],[0, 2, 0],[0, 2, 2]];
    if (type === 'J') return [[0, 3, 0],[0, 3, 0],[3, 3, 0]];
    if (type === 'O') return [[4, 4],[4, 4]];
    if (type === 'Z') return [[5, 5, 0],[0, 5, 5],[0, 0, 0]];
    if (type === 'S') return [[0, 6, 6],[6, 6, 0],[0, 0, 0]];
    if (type === 'T') return [[0, 7, 0],[7, 7, 7],[0, 0, 0]];
}

// Draw a single board
function drawBoard(ctx, arena, activePiece, activePos) {
    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw Arena
    drawMatrix(ctx, arena, {x:0, y:0});

    // Draw Active Piece
    if (activePiece) {
        drawMatrix(ctx, activePiece, activePos);
    }
}

function drawMatrix(ctx, matrix, offset) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                ctx.fillStyle = colors[value];
                ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
                // Simple border
                ctx.lineWidth = 0.05;
                ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
            }
        });
    });
}

function drawLocal() {
    drawBoard(ctxLocal, player.arena, player.matrix, player.pos);
}

function drawRemote() {
    drawBoard(ctxRemote, opponent.arena, opponent.matrix, opponent.pos);
}

// Main Update Loop
function update(time = 0) {
    if (!gameActive) return;

    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;

    if (dropCounter > dropInterval) {
        playerDrop();
    }

    drawLocal();
    requestAnimationFrame(update);
}

// Broadcasting state to server
function emitState() {
    socket.emit('update_state', {
        room: roomID,
        state: {
            arena: player.arena,
            matrix: player.matrix,
            pos: player.pos
        }
    });
}

function merge(arena, player) {
    player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                arena[y + player.pos.y][x + player.pos.x] = value;
            }
        });
    });
    emitState(); // Send updated board
}

function playerDrop() {
    player.pos.y++;
    if (collide(player.arena, player)) {
        player.pos.y--;
        merge(player.arena, player);
        playerReset();
        arenaSweep();
        emitState(); // Explicit update on lock
    }
    dropCounter = 0;
    emitState(); // Update opponent on falling
}

function playerReset() {
    const pieces = 'ILJOTSZ';
    player.matrix = createPiece(pieces[pieces.length * Math.random() | 0]);
    player.pos.y = 0;
    player.pos.x = (player.arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);

    if (collide(player.arena, player)) {
        // Game Over
        gameActive = false;
        socket.emit('player_game_over', { room: roomID });
        resultTitle.innerText = "YOU LOSE";
        resultTitle.classList.add('text-red-500');
        resultScreen.classList.remove('hidden');
    }
}

function arenaSweep() {
    let rowCount = 0;
    outer: for (let y = player.arena.length - 1; y > 0; --y) {
        for (let x = 0; x < player.arena[y].length; ++x) {
            if (player.arena[y][x] === 0) continue outer;
        }
        const row = player.arena.splice(y, 1)[0].fill(0);
        player.arena.unshift(row);
        ++y;
        rowCount++;
    }
    
    // Attack Logic
    if (rowCount > 1) {
        // Send (rowCount - 1) lines of garbage
        socket.emit('send_garbage', { room: roomID, lines: rowCount - 1 });
    }
    
    player.score += rowCount * 10;
    scoreElement.innerText = player.score;
}

function collide(arena, player) {
    const m = player.matrix;
    const o = player.pos;
    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
                return true;
            }
        }
    }
    return false;
}

// Controls
document.addEventListener('keydown', event => {
    if (!gameActive) return;

    if (event.keyCode === 37) { // Left
        player.pos.x--;
        if (collide(player.arena, player)) player.pos.x++;
        emitState();
    } else if (event.keyCode === 39) { // Right
        player.pos.x++;
        if (collide(player.arena, player)) player.pos.x--;
        emitState();
    } else if (event.keyCode === 40) { // Down
        playerDrop();
    } else if (event.keyCode === 81) { // Q
        playerRotate(-1);
    } else if (event.keyCode === 87 || event.keyCode === 38) { // W/Up
        playerRotate(1);
    }
});

function playerRotate(dir) {
    const pos = player.pos.x;
    let offset = 1;
    rotate(player.matrix, dir);
    while (collide(player.arena, player)) {
        player.pos.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (offset > player.matrix[0].length) {
            rotate(player.matrix, -dir);
            player.pos.x = pos;
            return;
        }
    }
    emitState();
}

function rotate(matrix, dir) {
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) {
            [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}