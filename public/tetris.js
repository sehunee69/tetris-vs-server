const canvas = document.getElementById('tetris');
const context = canvas.getContext('2d');

const nextCanvas = document.getElementById('next');
const nextContext = nextCanvas.getContext('2d');

const holdCanvas = document.getElementById('hold');
const holdContext = holdCanvas.getContext('2d');

const scoreElement = document.getElementById('score');
const levelElement = document.getElementById('level');
const startBtn = document.getElementById('start-btn');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');

context.scale(30, 30);
nextContext.scale(30, 30);
holdContext.scale(30, 30);

const colors = [
    null,
    '#ef4444',
    '#3b82f6',
    '#eab308',
    '#22c55e',
    '#a855f7',
    '#f97316',
    '#06b6d4',
];

const arena = createMatrix(12, 20);

const player = {
    pos: {x: 0, y: 0},
    matrix: null,
    next: null,
    hold: null,
    score: 0,
    level: 1,
    lines: 0,
};

let piecesBag = [];
let particles = []; 
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;
let isGameOver = false;
let isPaused = false;
let animationId = null;
let canHold = true;

// --- NEW: LOCK DELAY VARIABLES ---
let lockTimer = 0;
const lockLimit = 500; // 0.5 seconds to slide before locking

// --- SOUND SYNTHESIZER SYSTEM ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
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
    } 
    else if (type === 'clear') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } 
    else if (type === 'start') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(880, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
    }
}

function createMatrix(w, h) {
    const matrix = [];
    while (h--) {
        matrix.push(new Array(w).fill(0));
    }
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

function createParticles(x, y, color) {
    for (let i = 0; i < 12; i++) {
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
        p.x += p.velX; p.y += p.velY; p.velY += 0.02; p.life -= 0.03; 
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

function drawMatrix(matrix, offset, ctx) {
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                ctx.fillStyle = colors[value];
                ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
                ctx.lineWidth = 0.1; 
                ctx.strokeStyle = '#111827'; 
                ctx.strokeRect(x + offset.x + 0.05, y + offset.y + 0.05, 0.9, 0.9);
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.fillRect(x + offset.x, y + offset.y, 1, 0.15);
            }
        });
    });
}

function drawGhost(matrix, offset, ctx) {
    ctx.globalAlpha = 0.3;
    matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                ctx.fillStyle = colors[value];
                ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
                ctx.lineWidth = 0.05;
                ctx.strokeStyle = 'white';
                ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
            }
        });
    });
    ctx.globalAlpha = 1.0; 
}

function draw() {
    context.fillStyle = '#020617';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawMatrix(arena, {x: 0, y: 0}, context);
    const ghost = { matrix: player.matrix, pos: {x: player.pos.x, y: player.pos.y} };
    while (!collide(arena, ghost)) { ghost.pos.y++; }
    ghost.pos.y--;
    drawGhost(ghost.matrix, ghost.pos, context);
    drawMatrix(player.matrix, player.pos, context);
    drawParticles(context);
}

function drawNext() {
    nextContext.fillStyle = '#020617';
    nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (player.next) {
        const offsetX = (4 - player.next[0].length) / 2;
        const offsetY = (4 - player.next.length) / 2;
        drawMatrix(player.next, {x: offsetX, y: offsetY}, nextContext);
    }
}

function drawHold() {
    holdContext.fillStyle = '#020617';
    holdContext.fillRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (player.hold) {
        const offsetX = (4 - player.hold[0].length) / 2;
        const offsetY = (4 - player.hold.length) / 2;
        if (!canHold) holdContext.globalAlpha = 0.5;
        drawMatrix(player.hold, {x: offsetX, y: offsetY}, holdContext);
        holdContext.globalAlpha = 1.0;
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
    drawHold();
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
    while (collide(arena, player)) {
        player.pos.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (offset > player.matrix[0].length) {
            rotate(player.matrix, -dir);
            player.pos.x = pos;
            return;
        }
    }
    // --- NEW: Reset Lock Timer on successful rotation ---
    lockTimer = 0;
}

function playerHold() {
    if (!canHold) return;
    if (player.hold === null) {
        player.hold = player.matrix;
        player.matrix = player.next;
        player.next = getPieceFromBag();
        drawNext();
    } else {
        const temp = player.matrix;
        player.matrix = player.hold;
        player.hold = temp;
    }
    player.pos.y = 0;
    player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    canHold = false;
    drawHold();
    // --- NEW: Reset Lock Timer on hold ---
    lockTimer = 0;
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

// --- NEW: Helper to check if on ground ---
function isGrounded() {
    player.pos.y++;
    const collision = collide(arena, player);
    player.pos.y--;
    return collision;
}

function playerReset() {
    if (player.next === null) {
        player.next = getPieceFromBag();
    }
    player.matrix = player.next;
    player.next = getPieceFromBag();
    player.pos.y = 0;
    player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    drawNext();
    lockTimer = 0; // Reset timer on new piece spawn

    if (collide(arena, player)) {
        isGameOver = true;
        overlayTitle.innerText = "GAME OVER";
        overlay.classList.remove('hidden');
        cancelAnimationFrame(animationId);
    }
}

function arenaSweep() {
    let rowCount = 0;
    outer: for (let y = arena.length - 1; y > 0; --y) {
        for (let x = 0; x < arena[y].length; ++x) {
            if (arena[y][x] === 0) continue outer;
        }
        for (let x = 0; x < arena[y].length; ++x) {
            const colorIndex = arena[y][x];
            const color = colors[colorIndex];
            createParticles(x, y, color);
        }
        const row = arena.splice(y, 1)[0].fill(0);
        arena.unshift(row);
        ++y;
        rowCount++;
    }
    if (rowCount > 0) {
        playSound('clear');
        const lineScores = [0, 40, 100, 300, 1200];
        player.score += lineScores[rowCount] * player.level;
        player.lines += rowCount;
        player.level = Math.floor(player.lines / 5) + 1;
        updateScore();
    }
}

function playerDrop() {
    player.pos.y++;
    if (collide(arena, player)) {
        player.pos.y--;
    }
    dropCounter = 0;
}

function playerHardDrop() {
    while (!collide(arena, player)) {
        player.pos.y++;
    }
    player.pos.y--; 
    merge(arena, player);
    playerReset();
    arenaSweep();
    updateScore();
    dropCounter = 0;
    lockTimer = 0; // Ensure timer is reset
}

function updateScore() {
    scoreElement.innerText = player.score;
    levelElement.innerText = player.level;
}

function update(time = 0) {
    if (isGameOver || isPaused) return;

    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;

    dropInterval = Math.max(50, 1000 - (player.level - 1) * 100);

    
    if (dropCounter > dropInterval) playerDrop();

    
    if (isGrounded()) {
        lockTimer += deltaTime;
        if (lockTimer > lockLimit) {
            // Lock the piece.
            merge(arena, player);
            playerReset();
            arenaSweep();
            updateScore();
            lockTimer = 0;
        }
    } else {
        
        lockTimer = 0;
    }
    

    updateParticles();
    draw();
    animationId = requestAnimationFrame(update);
}

document.addEventListener('keydown', event => {
    if (isGameOver || isPaused) return;

    if([32, 37, 38, 39, 40].indexOf(event.keyCode) > -1) {
        event.preventDefault();
    }

    if (event.keyCode === 37 || event.keyCode === 65) { // Left
        player.pos.x--;
        if (collide(arena, player)) {
            player.pos.x++;
        } else {
            lockTimer = 0; // Reset timer on successful move
        }
    } 
    else if (event.keyCode === 39 || event.keyCode === 68) { // Right
        player.pos.x++;
        if (collide(arena, player)) {
            player.pos.x--;
        } else {
            lockTimer = 0; // Reset timer on successful move
        }
    } 
    else if (event.keyCode === 40 || event.keyCode === 83) { // Down
        playerDrop();
    } 
    else if (event.keyCode === 38 || event.keyCode === 87) { // Rotate
        playerRotate(1);
    }
    else if (event.keyCode === 32) { // Hard Drop
        playerHardDrop();
    }
    else if (event.keyCode === 67) { // Hold
        playerHold();
    }
});

startBtn.addEventListener('click', () => {
    playSound('start');
    if (isGameOver) {
        arena.forEach(row => row.fill(0));
        player.score = 0;
        player.level = 1;
        player.lines = 0;
        player.next = null;
        player.hold = null;
        piecesBag = []; 
        particles = []; 
        canHold = true;
        lockTimer = 0; // Reset
        updateScore();
        drawHold();
        isGameOver = false;
        overlay.classList.add('hidden');
        playerReset();
        update();
    } else if (!animationId) {
        playerReset();
        update();
    }
});