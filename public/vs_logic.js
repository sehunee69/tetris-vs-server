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
        osc.type = 'triangle'; osc.frequency.setValueAtTime(200, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1); osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'clear') {
        osc.type = 'square'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15); osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'start') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(220, now); osc.frequency.linearRampToValueAtTime(880, now + 0.4);
        gain.gain.setValueAtTime(0.2, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.4); osc.start(now); osc.stop(now + 0.4);
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

// --- MODERN INPUT CONTROLLER ---
const Input = {
    keys: { 
        ArrowLeft: false, ArrowRight: false, ArrowDown: false,
        KeyA: false, KeyD: false, KeyS: false
    },
    
    DAS: 100,  
    ARR: 0,    
    
    timer: 0,
    currentDir: 0,
    lastKeyPressed: null, 
    
    update(deltaTime) {
        let left = this.keys.ArrowLeft || this.keys.KeyA;
        let right = this.keys.ArrowRight || this.keys.KeyD;
        let requestedDir = 0;

        if (left && right) {
            if (this.lastKeyPressed === 'left') requestedDir = -1;
            else if (this.lastKeyPressed === 'right') requestedDir = 1;
        } else if (left) {
            requestedDir = -1;
        } else if (right) {
            requestedDir = 1;
        }

        if (requestedDir !== this.currentDir) {
            this.currentDir = requestedDir;
            this.timer = 0;
            return requestedDir; 
        } 
        else if (requestedDir !== 0) {
            this.timer += deltaTime;
            if (this.timer >= this.DAS) {
                if (this.ARR === 0) return "INSTANT"; 
                return requestedDir;
            }
        }
        return 0; 
    }
};

context.scale(25, 25); 
remoteContext.scale(25, 25);
nextContext.scale(20, 20);
holdContext.scale(20, 20);

const colors = [
    null, '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#4b5563' 
];

// --- GAME STATE ---
let roomID = null;
let gameActive = false;
let isPaused = false;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;

let difficultyTimer = 0;
const difficultyInterval = 30000; 

// --- NEW: LOCK DELAY VARIABLES ---
let lockTimer = 0;
const lockLimit = 500; // 0.5s to rotate before locking

let particles = [];
let piecesBag = [];
let canHold = true;

const player = {
    pos: {x: 0, y: 0},
    matrix: null,
    nextQueue: [],
    hold: null,
    score: 0,
    arena: createMatrix(12, 24),
    rotateIndex: 0 
};

const opponent = {
    matrix: null,
    pos: {x: 0, y: 0},
    arena: createMatrix(12, 24)
};

// --- SRS KICK TABLES ---
const JLSTZ_KICKS = [
    [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]], 
    [[0,0], [1,0], [1,1], [0,-2], [1,-2]],   
    [[0,0], [1,0], [1,-1], [0,2], [1,2]],    
    [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]] 
];
const I_KICKS = [
    [[0,0], [-2,0], [1,0], [-2,1], [1,-2]],  
    [[0,0], [-1,0], [2,0], [-1,-2], [2,1]],  
    [[0,0], [2,0], [-1,0], [2,-1], [-1,2]],  
    [[0,0], [1,0], [-2,0], [1,2], [-2,-1]]   
];
const JLSTZ_KICKS_CCW = [
    [[0,0], [1,0], [1,1], [0,-2], [1,-2]],   
    [[0,0], [1,0], [1,-1], [0,2], [1,2]],    
    [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
    [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]]  
];
const I_KICKS_CCW = [
    [[0,0], [-1,0], [2,0], [-1,2], [2,-1]],  
    [[0,0], [2,0], [-1,0], [2,1], [-1,-2]],  
    [[0,0], [1,0], [-2,0], [1,-2], [-2,1]],  
    [[0,0], [-2,0], [1,0], [-2,-1], [1,2]]   
];

function createMatrix(w, h) {
    const matrix = [];
    while (h--) matrix.push(new Array(w).fill(0));
    return matrix;
}

function createPiece(type) {
    if (type === 'I') return [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]];
    if (type === 'J') return [[3, 0, 0], [3, 3, 3], [0, 0, 0]];
    if (type === 'L') return [[0, 0, 2], [2, 2, 2], [0, 0, 0]];
    if (type === 'O') return [[4, 4], [4, 4]];
    if (type === 'S') return [[0, 6, 6], [6, 6, 0], [0, 0, 0]];
    if (type === 'T') return [[0, 7, 0], [7, 7, 7], [0, 0, 0]];
    if (type === 'Z') return [[5, 5, 0], [0, 5, 5], [0, 0, 0]];
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

function updateNextQueue() {
    while (player.nextQueue.length < 5) {
        player.nextQueue.push(getPieceFromBag());
    }
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
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1.0;
}

function drawMatrix(ctx, matrix, offset) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                ctx.fillStyle = colors[value];
                ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
                ctx.lineWidth = 0.05; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
                ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + offset.x, y + offset.y, 1, 0.2);
            }
        });
    });
}

function drawGhost(ctx, arena, playerMatrix, playerPos) {
    const ghostPos = { ...playerPos };
    while (!collide(arena, { matrix: playerMatrix, pos: ghostPos })) {
        ghostPos.y++;
    }
    ghostPos.y--; 
    ctx.globalAlpha = 0.2;
    drawMatrix(ctx, playerMatrix, ghostPos);
    ctx.globalAlpha = 1.0;
}

function draw() {
    context.fillStyle = '#020617'; context.fillRect(0, 0, canvas.width, canvas.height);
    drawMatrix(context, player.arena, {x:0, y:0});
    drawGhost(context, player.arena, player.matrix, player.pos);
    drawMatrix(context, player.matrix, player.pos);
    drawParticles(context);
}

function drawRemote() {
    remoteContext.fillStyle = '#020617'; remoteContext.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);
    drawMatrix(remoteContext, opponent.arena, {x:0, y:0});
    if (opponent.matrix) {
        drawGhost(remoteContext, opponent.arena, opponent.matrix, opponent.pos);
        drawMatrix(remoteContext, opponent.matrix, opponent.pos);
    }
}

function drawPreview() {
    nextContext.fillStyle = '#111827'; nextContext.fillRect(0,0, nextCanvas.width, nextCanvas.height);
    if (player.nextQueue.length === 0) updateNextQueue();
    player.nextQueue.forEach((piece, index) => {
        const offsetX = (5 - piece[0].length) / 2;
        const offsetY = 1 + (index * 4);
        drawMatrix(nextContext, piece, {x: offsetX, y: offsetY});
    });

    holdContext.fillStyle = '#111827'; holdContext.fillRect(0,0, holdCanvas.width, holdCanvas.height);
    if(player.hold) {
        const offX = (5 - player.hold[0].length)/2; 
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
    for(let i=0; i<count; i++){
        const row = new Array(12).fill(8); 
        row[Math.floor(Math.random()*12)] = 0; 
        player.arena.push(row); player.arena.shift(); 
    }
    canvas.style.transform = "translateX(5px)";
    setTimeout(() => canvas.style.transform = "none", 50);
    emitState();
});

socket.on('opponent_game_over', () => { endGame(true); });

function emitState() {
    if (!gameActive) return;
    socket.emit('update_state', {
        room: roomID,
        state: { arena: player.arena, matrix: player.matrix, pos: player.pos }
    });
}

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
    player.arena.forEach(row => row.fill(0));
    player.score = 0; player.hold = null; canHold = true; 
    piecesBag = []; particles = []; player.nextQueue = []; 
    dropInterval = 1000; difficultyTimer = 0;
    updateNextQueue(); 
    playerReset();
    gameActive = true;
    update();
}

function playerReset() {
    if (player.nextQueue.length === 0) updateNextQueue();
    player.matrix = player.nextQueue.shift(); 
    updateNextQueue(); 
    player.pos.y = 0; player.pos.x = (player.arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    player.rotateIndex = 0; 
    drawPreview();
    lockTimer = 0; // Reset lock on spawn
    if (collide(player.arena, player)) endGame(false);
    emitState();
}

function endGame(win) {
    gameActive = false;
    if(!win) socket.emit('player_game_over', { room: roomID }); 
    resultTitle.innerText = win ? "YOU WIN!" : "YOU LOSE";
    resultTitle.className = win ? "text-6xl font-bold mb-4 text-green-500" : "text-6xl font-bold mb-4 text-red-500";
    resultScreen.style.display = 'flex';
}

function collide(arena, player) {
    const m = player.matrix; const o = player.pos;
    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) return true;
        }
    }
    return false;
}

// --- NEW: GROUND CHECK HELPER ---
function isGrounded() {
    player.pos.y++;
    const collision = collide(player.arena, player);
    player.pos.y--;
    return collision;
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
    let type = 'T'; 
    if (player.matrix.length === 4) type = 'I';
    else if (player.matrix.length === 2) type = 'O'; 
    if (type === 'O') return; 
    
    const oldRot = player.rotateIndex;
    const newRot = (oldRot + dir + 4) % 4;
    const oldX = player.pos.x;
    const oldY = player.pos.y;
    
    rotate(player.matrix, dir);
    
    let kicks;
    if (type === 'I') kicks = (dir > 0) ? I_KICKS[oldRot] : I_KICKS_CCW[oldRot];
    else kicks = (dir > 0) ? JLSTZ_KICKS[oldRot] : JLSTZ_KICKS_CCW[oldRot];
    
    for (let i = 0; i < kicks.length; i++) {
        const offset = kicks[i];
        player.pos.x = oldX + offset[0];
        player.pos.y = oldY - offset[1]; 
        
        if (!collide(player.arena, player)) {
            player.rotateIndex = newRot;
            lockTimer = 0; // SUCCESS: Reset Lock Timer (Infinity Spin)
            emitState(); 
            return;
        }
    }
    
    rotate(player.matrix, -dir);
    player.pos.x = oldX;
    player.pos.y = oldY;
}

function playerHold() {
    if(!canHold) return;
    if(!player.hold) {
        player.hold = player.matrix; 
        player.matrix = player.nextQueue.shift(); 
        updateNextQueue();
    } else {
        const temp = player.matrix; player.matrix = player.hold; player.hold = temp;
    }
    player.pos.y = 0; player.pos.x = (player.arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    player.rotateIndex = 0; 
    canHold = false; lockTimer = 0; // Reset Lock
    drawPreview(); emitState();
}

function arenaSweep() {
    let rowCount = 0;
    outer: for (let y = player.arena.length - 1; y > 0; --y) {
        for (let x = 0; x < player.arena[y].length; ++x) if (player.arena[y][x] === 0) continue outer;
        for(let x=0; x<player.arena[y].length; x++) createParticles(x, y, colors[player.arena[y][x]]);
        const row = player.arena.splice(y, 1)[0].fill(0); player.arena.unshift(row); ++y; rowCount++;
    }
    if (rowCount > 0) {
        playSound('clear');
        player.score += rowCount * 100; scoreElement.innerText = player.score;
        if (rowCount > 1) socket.emit('send_garbage', { room: roomID, lines: rowCount - 1 });
    }
}

function merge(arena, player) {
    player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) arena[y + player.pos.y][x + player.pos.x] = value;
        });
    });
    playSound('drop'); canHold = true; drawPreview(); emitState();
}

// FIXED: Doesn't merge immediately. Just moves.
function playerDrop() {
    player.pos.y++;
    if (collide(player.arena, player)) {
        player.pos.y--; 
        // Do NOT merge here. Let the Lock Timer handle it.
    }
    dropCounter = 0;
    emitState();
}

function playerHardDrop() {
    while (!collide(player.arena, player)) player.pos.y++;
    player.pos.y--; merge(player.arena, player); playerReset(); arenaSweep(); emitState(); dropCounter = 0; lockTimer = 0;
}

function update(time = 0) {
    if (!gameActive) return;

    const deltaTime = time - lastTime;
    lastTime = time;
    
    // --- INPUT LOGIC ---
    const moveCommand = Input.update(deltaTime);

    if (moveCommand === "INSTANT") {
        let moved = false;
        while (!collide(player.arena, { ...player, pos: { x: player.pos.x + Input.currentDir, y: player.pos.y } })) {
            player.pos.x += Input.currentDir;
            moved = true;
        }
        if (moved) {
            lockTimer = 0; // Reset on move
            emitState();
        }
    } 
    else if (moveCommand !== 0) {
        player.pos.x += moveCommand;
        if (collide(player.arena, player)) {
            player.pos.x -= moveCommand;
        } else {
            lockTimer = 0; // Reset on move
            emitState();
        }
    }
    
    // Soft Drop
    if (Input.keys.ArrowDown || Input.keys.KeyS) {
        dropCounter += deltaTime * 20;
    }
    
    // --- GRAVITY ---
    dropCounter += deltaTime;
    difficultyTimer += deltaTime;

    if (difficultyTimer > difficultyInterval) {
        difficultyTimer = 0; dropInterval = dropInterval * 0.9;
        if (dropInterval < 100) dropInterval = 100; 
    }

    if (dropCounter > dropInterval) playerDrop();
    
    // --- NEW: LOCK DELAY LOGIC ---
    if (isGrounded()) {
        lockTimer += deltaTime;
        if (lockTimer > lockLimit) {
            merge(player.arena, player);
            playerReset();
            arenaSweep();
            emitState();
            lockTimer = 0;
        }
    } else {
        lockTimer = 0;
    }

    updateParticles();
    draw(); 
    requestAnimationFrame(update);
}

document.addEventListener('keydown', event => {
    if (!gameActive) return;
    if([32, 37, 38, 39, 40].indexOf(event.keyCode) > -1) event.preventDefault();

    if (Input.keys.hasOwnProperty(event.code)) {
        Input.keys[event.code] = true;
        if (event.code === 'ArrowLeft' || event.code === 'KeyA') Input.lastKeyPressed = 'left';
        if (event.code === 'ArrowRight' || event.code === 'KeyD') Input.lastKeyPressed = 'right';
    }

    switch(event.code) {
        case 'ArrowUp':
        case 'KeyW': playerRotate(1); break;
        case 'Space': playerHardDrop(); break;
        case 'KeyC': playerHold(); break;
    }
});

document.addEventListener('keyup', event => {
    if (Input.keys.hasOwnProperty(event.code)) {
        Input.keys[event.code] = false;
        if ((event.code === 'ArrowLeft' || event.code === 'KeyA') && Input.lastKeyPressed === 'left') {
            if (Input.keys.ArrowRight || Input.keys.KeyD) Input.lastKeyPressed = 'right';
            else Input.lastKeyPressed = null;
        }
        if ((event.code === 'ArrowRight' || event.code === 'KeyD') && Input.lastKeyPressed === 'right') {
            if (Input.keys.ArrowLeft || Input.keys.KeyA) Input.lastKeyPressed = 'left';
            else Input.lastKeyPressed = null;
        }
    }
});