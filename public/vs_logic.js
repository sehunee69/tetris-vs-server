// --- SOCKET CONNECTION (Updated to Render) ---
const socket = io('https://vstetris.onrender.com');

// --- AUDIO SYSTEM ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'drop') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'clear') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } else if (type === 'start') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(880, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
    }
}

// --- SETUP CANVAS ---
const canvas = document.getElementById('local');
const context = canvas.getContext('2d');
const remoteCanvas = document.getElementById('remote');
const remoteContext = remoteCanvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextContext = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold');
const holdContext = holdCanvas.getContext('2d');

// UI Elements
const waitingScreen = document.getElementById('waiting-screen');
const countdownScreen = document.getElementById('countdown-screen');
const countdownText = document.getElementById('countdown-text');
const resultScreen = document.getElementById('result-screen');
const resultTitle = document.getElementById('result-title');
const scoreElement = document.getElementById('score');

// Scale everything
context.scale(25, 25); // 12x24 grid = 300x600 pixels
remoteContext.scale(25, 25);
nextContext.scale(20, 20);
holdContext.scale(20, 20);

const colors = [
    null,
    '#ef4444', '#3b82f6', '#eab308', '#22c55e', 
    '#a855f7', '#f97316', '#06b6d4', '#4b5563' // #4b5563 is Grey (Garbage)
];

// --- GAME STATE ---
let roomID = null;
let gameActive = false;
let isPaused = false;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;

// Difficulty Variables
let difficultyTimer = 0;
const difficultyInterval = 30000; // 30 Seconds

let particles = [];
let piecesBag = [];
let canHold = true;

const player = {
    pos: {x: 0, y: 0},
    matrix: null,
    next: null,
    hold: null,
    score: 0,
    arena: createMatrix(12, 24),
};

// Opponent State
const opponent = {
    matrix: null,
    pos: {x: 0, y: 0},
    arena: createMatrix(12, 24)
};

// --- HELPER FUNCTIONS ---
function createMatrix(w, h) {
    const matrix = [];
    while (h--) matrix.push(new Array(w).fill(0));
    return matrix;
}

function createPiece(type) {
    if (type === 'I') return [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]];
    if (type === 'L') return [[0,2,0],[0,2,0],[0,2,2]];
    if (type === 'J') return [[0,3,0],[0,3,0],[3,3,0]];
    if (type === 'O') return [[4,4],[4,4]];
    if (type === 'Z') return [[5,5,0],[0,5,5],[0,0,0]];
    if (type === 'S') return [[0,6,6],[6,6,0],[0,0,0]];
    if (type === 'T') return [[0,7,0],[7,7,7],[0,0,0]];
}

function getPieceFromBag() {
    if (piecesBag.length === 0) {
        piecesBag = ['I', 'L', 'J', 'O', 'T', 'S', 'Z'];
        for (let i = piecesBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [piecesBag[i], piecesBag[j]] = [piecesBag[j], piecesBag[i]];
        }
    }
    return createPiece(piecesBag.pop());
}

// --- VISUALS ---
function createParticles(x, y, color) {
    for (let i = 0; i < 8; i++) {
        particles.push({
            x: x + 0.5, y: y + 0.5,
            velX: (Math.random() - 0.5) * 0.8,
            velY: (Math.random() - 0.5) * 0.8,
            life: 1.0, color: color, size: Math.random() * 0.3 + 0.1
        });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.velX; p.y += p.velY; p.velY += 0.02; p.life -= 0.05;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function drawParticles(ctx) {
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1.0;
}

function drawMatrix(ctx, matrix, offset) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                ctx.fillStyle = colors[value];
                ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
                ctx.lineWidth = 0.05;
                ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
                
                // Shine
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                ctx.fillRect(x + offset.x, y + offset.y, 1, 0.2);
            }
        });
    });
}

function drawGhost(ctx, arena, playerMatrix, playerPos) {
    const ghostPos = { ...playerPos };
    while (!collide(arena, { matrix: playerMatrix, pos: ghostPos })) {
        ghostPos.y++;
    }
    ghostPos.y--; // Step back up
    
    ctx.globalAlpha = 0.2;
    drawMatrix(ctx, playerMatrix, ghostPos);
    ctx.globalAlpha = 1.0;
}

// Draw Local Player
function draw() {
    context.fillStyle = '#020617';
    context.fillRect(0, 0, canvas.width, canvas.height);

    drawMatrix(context, player.arena, {x:0, y:0});
    drawGhost(context, player.arena, player.matrix, player.pos);
    drawMatrix(context, player.matrix, player.pos);
    
    drawParticles(context);
}

// Draw Remote Opponent (NOW WITH GHOST & CONSISTENT STYLE)
function drawRemote() {
    remoteContext.fillStyle = '#020617';
    remoteContext.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);
    
    drawMatrix(remoteContext, opponent.arena, {x:0, y:0});
    
    if (opponent.matrix) {
        // Show opponent ghost so it matches local player design
        drawGhost(remoteContext, opponent.arena, opponent.matrix, opponent.pos);
        drawMatrix(remoteContext, opponent.matrix, opponent.pos);
    }
}

function drawPreview() {
    // Next
    nextContext.fillStyle = '#111827';
    nextContext.fillRect(0,0, nextCanvas.width, nextCanvas.height);
    if(player.next) {
        const offX = (4 - player.next[0].length)/2;
        const offY = (4 - player.next.length)/2;
        drawMatrix(nextContext, player.next, {x:offX, y:offY});
    }

    // Hold
    holdContext.fillStyle = '#111827';
    holdContext.fillRect(0,0, holdCanvas.width, holdCanvas.height);
    if(player.hold) {
        const offX = (4 - player.hold[0].length)/2;
        const offY = (4 - player.hold.length)/2;
        if(!canHold) holdContext.globalAlpha = 0.5;
        drawMatrix(holdContext, player.hold, {x:offX, y:offY});
        holdContext.globalAlpha = 1.0;
    }
}

// --- SOCKET LOGIC ---
socket.emit('join_queue');

socket.on('match_found', (id) => {
    roomID = id;
    waitingScreen.style.display = 'none';
    startCountdown();
});

socket.on('opponent_update', (state) => {
    opponent.arena = state.arena;
    opponent.matrix = state.matrix;
    opponent.pos = state.pos;
    drawRemote();
});

socket.on('receive_garbage', (count) => {
    // Add grey lines at bottom with randomized holes
    for(let i=0; i<count; i++){
        const row = new Array(12).fill(8); // 8 = Grey
        row[Math.floor(Math.random()*12)] = 0; // One random hole for digging
        player.arena.push(row);
        player.arena.shift(); // Push top off
    }
    // Shake effect
    canvas.style.transform = "translateX(5px)";
    setTimeout(() => canvas.style.transform = "none", 50);
    emitState();
});

socket.on('opponent_game_over', () => {
    endGame(true); // You Win
});

function emitState() {
    if (!gameActive) return;
    socket.emit('update_state', {
        room: roomID,
        state: {
            arena: player.arena,
            matrix: player.matrix,
            pos: player.pos
        }
    });
}

// --- GAME LOGIC ---

function startCountdown() {
    countdownScreen.style.display = 'flex';
    let count = 3;
    playSound('start'); 
    
    const intv = setInterval(() => {
        count--;
        if(count > 0) countdownText.innerText = count;
        else if(count === 0) countdownText.innerText = "GO!";
        else {
            clearInterval(intv);
            countdownScreen.style.display = 'none';
            startGame();
        }
    }, 1000);
}

function startGame() {
    // Reset Player
    player.arena.forEach(row => row.fill(0));
    player.score = 0;
    player.hold = null;
    canHold = true;
    piecesBag = [];
    particles = [];
    
    // RESET DIFFICULTY
    dropInterval = 1000;
    difficultyTimer = 0;
    
    player.next = getPieceFromBag();
    playerReset();
    
    gameActive = true;
    update();
}

function playerReset() {
    player.matrix = player.next;
    player.next = getPieceFromBag();
    player.pos.y = 0;
    player.pos.x = (player.arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    
    drawPreview();
    
    if (collide(player.arena, player)) {
        endGame(false); // You Lose
    }
    emitState();
}

function endGame(win) {
    gameActive = false;
    socket.emit('player_game_over', { room: roomID }); // Tell server
    
    resultTitle.innerText = win ? "YOU WIN!" : "YOU LOSE";
    resultTitle.className = win ? "text-6xl font-bold mb-4 text-green-500" : "text-6xl font-bold mb-4 text-red-500";
    resultScreen.style.display = 'flex';
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

function rotate(matrix, dir) {
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) {
            [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}

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

function playerHold() {
    if(!canHold) return;
    if(!player.hold) {
        player.hold = player.matrix;
        player.matrix = player.next;
        player.next = getPieceFromBag();
    } else {
        const temp = player.matrix;
        player.matrix = player.hold;
        player.hold = temp;
    }
    player.pos.y = 0;
    player.pos.x = (player.arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    canHold = false;
    drawPreview();
    emitState();
}

function arenaSweep() {
    let rowCount = 0;
    outer: for (let y = player.arena.length - 1; y > 0; --y) {
        for (let x = 0; x < player.arena[y].length; ++x) {
            if (player.arena[y][x] === 0) continue outer;
        }
        
        // Particles
        for(let x=0; x<player.arena[y].length; x++) {
            createParticles(x, y, colors[player.arena[y][x]]);
        }

        const row = player.arena.splice(y, 1)[0].fill(0);
        player.arena.unshift(row);
        ++y;
        rowCount++;
    }

    if (rowCount > 0) {
        playSound('clear');
        player.score += rowCount * 100;
        scoreElement.innerText = player.score;
        
        // GARBAGE ATTACK logic
        if (rowCount > 1) {
            socket.emit('send_garbage', { room: roomID, lines: rowCount - 1 });
        }
    }
}

function merge(arena, player) {
    player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                arena[y + player.pos.y][x + player.pos.x] = value;
            }
        });
    });
    playSound('drop');
    canHold = true;
    drawPreview();
    emitState();
}

function playerDrop() {
    player.pos.y++;
    if (collide(player.arena, player)) {
        player.pos.y--;
        merge(player.arena, player);
        playerReset();
        arenaSweep();
        emitState();
    }
    dropCounter = 0;
    emitState(); // Sync falling movement
}

function playerHardDrop() {
    while (!collide(player.arena, player)) {
        player.pos.y++;
    }
    player.pos.y--;
    merge(player.arena, player);
    playerReset();
    arenaSweep();
    emitState();
    dropCounter = 0;
}

function update(time = 0) {
    if (!gameActive) return;

    const deltaTime = time - lastTime;
    lastTime = time;
    
    dropCounter += deltaTime;
    difficultyTimer += deltaTime;

    // --- DIFFICULTY LOGIC (Speeds up every 30s) ---
    if (difficultyTimer > difficultyInterval) {
        difficultyTimer = 0;
        dropInterval = dropInterval * 0.9; // 10% Faster
        if (dropInterval < 100) dropInterval = 100; // Cap max speed
    }

    if (dropCounter > dropInterval) {
        playerDrop();
    }
    
    updateParticles();
    draw(); 
    // Note: drawRemote is called via socket event

    requestAnimationFrame(update);
}

// --- CONTROLS ---
document.addEventListener('keydown', event => {
    if (!gameActive) return;

    if([32, 37, 38, 39, 40].indexOf(event.keyCode) > -1) event.preventDefault();

    if (event.keyCode === 37 || event.keyCode === 65) { // Left
        player.pos.x--;
        if (collide(player.arena, player)) player.pos.x++;
        emitState();
    } 
    else if (event.keyCode === 39 || event.keyCode === 68) { // Right
        player.pos.x++;
        if (collide(player.arena, player)) player.pos.x--;
        emitState();
    } 
    else if (event.keyCode === 40 || event.keyCode === 83) { // Down
        playerDrop();
    } 
    else if (event.keyCode === 38 || event.keyCode === 87) { // Up (Rotate)
        playerRotate(1);
    }
    else if (event.keyCode === 32) { // Space (Hard Drop)
        playerHardDrop();
    }
    else if (event.keyCode === 67) { // C (Hold)
        playerHold();
    }
});