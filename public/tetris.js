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

// --- 1. PRO INPUT SETTINGS (TETR.IO STYLE) ---
const Input = {
    keys: { 
        ArrowLeft: false, ArrowRight: false, ArrowDown: false,
        KeyA: false, KeyD: false, KeyS: false
    },
    
    // TWEAK THESE NUMBERS!
    DAS: 100,  // Reduced from 130 -> 100ms (Snappier start)
    ARR: 0,    // 0 = Instant Teleport. Change to 10 for "Fast Slide"
    
    timer: 0,
    currentDir: 0,
    lastKeyPressed: null,
    
    update(deltaTime) {
        let left = this.keys.ArrowLeft || this.keys.KeyA;
        let right = this.keys.ArrowRight || this.keys.KeyD;
        let requestedDir = 0;

        // Last Key Priority
        if (left && right) {
            if (this.lastKeyPressed === 'left') requestedDir = -1;
            else if (this.lastKeyPressed === 'right') requestedDir = 1;
        } else if (left) {
            requestedDir = -1;
        } else if (right) {
            requestedDir = 1;
        }

        // DAS / ARR Logic
        if (requestedDir !== this.currentDir) {
            this.currentDir = requestedDir;
            this.timer = 0;
            return requestedDir; // Immediate tap
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

const colors = [
    null, '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316', '#06b6d4',
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
    rotateIndex: 0 // 0=Spawn, 1=Right, 2=Flip, 3=Left
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

// --- LOCK DELAY ---
let lockTimer = 0;
const lockLimit = 500; 

// --- 2. SUPER ROTATION SYSTEM (SRS) KICK TABLES ---
// These magic numbers allow pieces to spin into tight spots.
// Format: [x, y] kicks for 0->1, 1->2, 2->3, 3->0
const JLSTZ_KICKS = [
    [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]], // 0->1
    [[0,0], [1,0], [1,1], [0,-2], [1,-2]],   // 1->2
    [[0,0], [1,0], [1,-1], [0,2], [1,2]],    // 2->3
    [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]] // 3->0
];

const I_KICKS = [
    [[0,0], [-2,0], [1,0], [-2,1], [1,-2]],  // 0->1
    [[0,0], [-1,0], [2,0], [-1,-2], [2,1]],  // 1->2
    [[0,0], [2,0], [-1,0], [2,-1], [-1,2]],  // 2->3
    [[0,0], [1,0], [-2,0], [1,2], [-2,-1]]   // 3->0
];

// Inverse kicks (for rotating Counter-Clockwise)
const JLSTZ_KICKS_CCW = [
    [[0,0], [1,0], [1,1], [0,-2], [1,-2]],   // 0->3
    [[0,0], [1,0], [1,-1], [0,2], [1,2]],    // 1->0
    [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],// 2->1
    [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]]  // 3->2
];

const I_KICKS_CCW = [
    [[0,0], [-1,0], [2,0], [-1,2], [2,-1]],  // 0->3
    [[0,0], [2,0], [-1,0], [2,1], [-1,-2]],  // 1->0
    [[0,0], [1,0], [-2,0], [1,-2], [-2,1]],  // 2->1
    [[0,0], [-2,0], [1,0], [-2,-1], [1,2]]   // 3->2
];


const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'drop') {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(200, now); osc.frequency.exponentialRampToValueAtTime(50, now+0.1);
        gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.01, now+0.1); osc.start(now); osc.stop(now+0.1);
    } else if (type === 'clear') {
        osc.type = 'square'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(1200, now+0.15);
        gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.01, now+0.15); osc.start(now); osc.stop(now+0.15);
    } else if (type === 'start') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(220, now); osc.frequency.linearRampToValueAtTime(880, now+0.4);
        gain.gain.setValueAtTime(0.2, now); gain.gain.linearRampToValueAtTime(0.01, now+0.4); osc.start(now); osc.stop(now+0.4);
    }
}

function createMatrix(w, h) {
    const matrix = [];
    while (h--) matrix.push(new Array(w).fill(0));
    return matrix;
}

function createPiece(type) {
    // Note: I piece needs to be centered in 4x4
    if (type === 'I') return [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]];
    if (type === 'L') return [[0,2,0],[0,2,0],[0,2,2]];
    if (type === 'J') return [[0,3,0],[0,3,0],[3,3,0]];
    if (type === 'O') return [[4,4],[4,4]];
    if (type === 'Z') return [[5,5,0],[0,5,5],[0,0,0]];
    if (type === 'S') return [[0,6,6],[6,6,0],[0,0,0]];
    if (type === 'T') return [[0,7,0],[7,7,7],[0,0,0]];
}

function createParticles(x, y, color) {
    for (let i = 0; i < 12; i++) {
        particles.push({
            x: x + 0.5, y: y + 0.5,
            velX: (Math.random() - 0.5) * 0.8, velY: (Math.random() - 0.5) * 0.8,
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
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size);
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
                ctx.lineWidth = 0.1; ctx.strokeStyle = '#111827'; ctx.strokeRect(x + offset.x+0.05, y+offset.y+0.05, 0.9, 0.9);
                ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + offset.x, y + offset.y, 1, 0.15);
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
                ctx.lineWidth = 0.05; ctx.strokeStyle = 'white'; ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
            }
        });
    });
    ctx.globalAlpha = 1.0; 
}

function draw() {
    context.fillStyle = '#020617'; context.fillRect(0, 0, canvas.width, canvas.height);
    drawMatrix(arena, {x: 0, y: 0}, context);
    const ghost = { matrix: player.matrix, pos: {x: player.pos.x, y: player.pos.y} };
    while (!collide(arena, ghost)) ghost.pos.y++;
    ghost.pos.y--;
    drawGhost(ghost.matrix, ghost.pos, context);
    drawMatrix(player.matrix, player.pos, context);
    drawParticles(context);
}

function drawNext() {
    nextContext.fillStyle = '#020617'; nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (player.next) {
        const offsetX = (4 - player.next[0].length) / 2; const offsetY = (4 - player.next.length) / 2;
        drawMatrix(player.next, {x: offsetX, y: offsetY}, nextContext);
    }
}

function drawHold() {
    holdContext.fillStyle = '#020617'; holdContext.fillRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (player.hold) {
        const offsetX = (4 - player.hold[0].length) / 2; const offsetY = (4 - player.hold.length) / 2;
        if (!canHold) holdContext.globalAlpha = 0.5;
        drawMatrix(player.hold, {x: offsetX, y: offsetY}, holdContext);
        holdContext.globalAlpha = 1.0;
    }
}

function merge(arena, player) {
    player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) arena[y + player.pos.y][x + player.pos.x] = value;
        });
    });
    playSound('drop'); canHold = true; drawHold();
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

// --- 3. SRS ROTATION FUNCTION ---
function playerRotate(dir) {
    // 1. Determine Type
    let type = 'T'; // Default
    if (player.matrix.length === 4) type = 'I';
    else if (player.matrix.length === 2) type = 'O'; // O doesn't kick
    
    if (type === 'O') return; // O-piece simply ignores rotation
    
    // 2. Perform Basic Rotation
    const oldRot = player.rotateIndex;
    const newRot = (oldRot + dir + 4) % 4;
    const oldX = player.pos.x;
    const oldY = player.pos.y;
    
    rotate(player.matrix, dir);
    
    // 3. Wall Kick Tests
    // Select the correct table
    let kicks;
    if (type === 'I') kicks = (dir > 0) ? I_KICKS[oldRot] : I_KICKS_CCW[oldRot];
    else kicks = (dir > 0) ? JLSTZ_KICKS[oldRot] : JLSTZ_KICKS_CCW[oldRot];
    
    // Try all 5 positions (Offset 0 is usually [0,0])
    for (let i = 0; i < kicks.length; i++) {
        const offset = kicks[i];
        player.pos.x = oldX + offset[0];
        player.pos.y = oldY - offset[1]; // Y is inverted in Tetris kicks
        
        if (!collide(arena, player)) {
            // Success!
            player.rotateIndex = newRot;
            lockTimer = 0; // Reset lock
            return;
        }
    }
    
    // 4. Failed: Rotate Back
    rotate(player.matrix, -dir);
    player.pos.x = oldX;
    player.pos.y = oldY;
}

function playerHold() {
    if (!canHold) return;
    if (player.hold === null) {
        player.hold = player.matrix; player.matrix = player.next; player.next = getPieceFromBag(); drawNext();
    } else {
        const temp = player.matrix; player.matrix = player.hold; player.hold = temp;
    }
    player.pos.y = 0; player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    player.rotateIndex = 0; // Reset rotation on hold
    canHold = false; drawHold(); lockTimer = 0;
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

function isGrounded() {
    player.pos.y++; const collision = collide(arena, player); player.pos.y--; return collision;
}

function playerReset() {
    if (player.next === null) player.next = getPieceFromBag();
    player.matrix = player.next; player.next = getPieceFromBag();
    player.pos.y = 0; player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    player.rotateIndex = 0;
    drawNext(); lockTimer = 0; 
    if (collide(arena, player)) {
        isGameOver = true; overlayTitle.innerText = "GAME OVER"; overlay.classList.remove('hidden'); cancelAnimationFrame(animationId);
    }
}

function arenaSweep() {
    let rowCount = 0;
    outer: for (let y = arena.length - 1; y > 0; --y) {
        for (let x = 0; x < arena[y].length; ++x) if (arena[y][x] === 0) continue outer;
        for (let x = 0; x < arena[y].length; ++x) {
            const colorIndex = arena[y][x]; createParticles(x, y, colors[colorIndex]);
        }
        const row = arena.splice(y, 1)[0].fill(0); arena.unshift(row); ++y; rowCount++;
    }
    if (rowCount > 0) {
        playSound('clear');
        const lineScores = [0, 40, 100, 300, 1200];
        player.score += lineScores[rowCount] * player.level;
        player.lines += rowCount; player.level = Math.floor(player.lines / 5) + 1;
        updateScore();
    }
}

function playerDrop() {
    player.pos.y++;
    if (collide(arena, player)) player.pos.y--;
    dropCounter = 0;
}

function playerHardDrop() {
    while (!collide(arena, player)) player.pos.y++;
    player.pos.y--; merge(arena, player); playerReset(); arenaSweep(); updateScore(); dropCounter = 0; lockTimer = 0; 
}

function updateScore() {
    scoreElement.innerText = player.score; levelElement.innerText = player.level;
}

// --- MAIN UPDATE LOOP ---
function update(time = 0) {
    if (isGameOver || isPaused) return;

    const deltaTime = time - lastTime;
    lastTime = time;

    // 1. INPUT LOGIC
    const moveCommand = Input.update(deltaTime);

    if (moveCommand === "INSTANT") {
        while (!collide(arena, { ...player, pos: { x: player.pos.x + Input.currentDir, y: player.pos.y } })) {
            player.pos.x += Input.currentDir;
            lockTimer = 0;
        }
    } 
    else if (moveCommand !== 0) {
        player.pos.x += moveCommand;
        if (collide(arena, player)) {
            player.pos.x -= moveCommand;
        } else {
            lockTimer = 0;
        }
    }
    
    // Soft Drop
    if (Input.keys.ArrowDown || Input.keys.KeyS) {
        dropCounter += deltaTime * 20;
    }

    dropCounter += deltaTime;
    dropInterval = Math.max(50, 1000 - (player.level - 1) * 100);

    if (dropCounter > dropInterval) playerDrop();

    if (isGrounded()) {
        lockTimer += deltaTime;
        if (lockTimer > lockLimit) {
            merge(arena, player); playerReset(); arenaSweep(); updateScore(); lockTimer = 0;
        }
    } else {
        lockTimer = 0;
    }
    
    updateParticles();
    draw();
    animationId = requestAnimationFrame(update);
}

// --- CONTROLS ---
document.addEventListener('keydown', event => {
    if (isGameOver || isPaused) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();

    // 1. UPDATE KEY STATE
    if (Input.keys.hasOwnProperty(event.code)) {
        Input.keys[event.code] = true;
        
        // UPDATE PRIORITY: Remember what the LAST pressed horizontal key was
        if (event.code === 'ArrowLeft' || event.code === 'KeyA') Input.lastKeyPressed = 'left';
        if (event.code === 'ArrowRight' || event.code === 'KeyD') Input.lastKeyPressed = 'right';
    }

    // 2. INSTANT ACTIONS
    switch(event.code) {
        case 'ArrowUp':
        case 'KeyW':
            playerRotate(1);
            break;
        case 'Space':
            playerHardDrop();
            break;
        case 'KeyC':
            playerHold();
            break;
    }
});

document.addEventListener('keyup', event => {
    if (Input.keys.hasOwnProperty(event.code)) {
        Input.keys[event.code] = false;
        
        // PRIORITY CLEANUP
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

startBtn.addEventListener('click', () => {
    playSound('start');
    if (isGameOver) {
        arena.forEach(row => row.fill(0));
        player.score = 0; player.level = 1; player.lines = 0; player.next = null; player.hold = null;
        piecesBag = []; particles = []; canHold = true; lockTimer = 0; updateScore(); drawHold();
        isGameOver = false; overlay.classList.add('hidden'); playerReset(); update();
    } else if (!animationId) {
        playerReset(); update();
    }
});