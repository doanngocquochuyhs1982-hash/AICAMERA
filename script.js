/* ═══════════════════════════════════════════════
   PRO AI CAMERA  ·  script.js
   Features: frame-skip, confidence filter, per-class
   colours, sound alert (Web Audio), object type panel,
   dark/light theme, snapshot, splash progress.
   ═══════════════════════════════════════════════ */

/* ── DOM refs ── */
const video      = document.getElementById('video');
const canvas     = document.getElementById('canvas');
const ctx        = canvas.getContext('2d');
const startBtn   = document.getElementById('startBtn');
const stopBtn    = document.getElementById('stopBtn');
const flipBtn    = document.getElementById('flipBtn');
const snapBtn    = document.getElementById('snapBtn');
const soundBtn   = document.getElementById('soundBtn');
const aiToggle   = document.getElementById('aiToggle');
const themeBtn   = document.getElementById('themeBtn');
const fpsDisplay = document.getElementById('fpsDisplay');
const objCount   = document.getElementById('objectCount');
const modelStat  = document.getElementById('modelStatus');
const clockEl    = document.getElementById('clock');
const aiStatus   = document.getElementById('aiStatus');
const dot        = document.getElementById('dot');
const viewport   = document.getElementById('viewport');
const camLoading = document.getElementById('camLoading');
const liveBadge  = document.getElementById('liveBadge');
const confBadge  = document.getElementById('confBadge');
const modeBadge  = document.getElementById('modeBadge');
const typePanel  = document.getElementById('typePanel');
const fastBtn    = document.getElementById('fastBtn');
const accurateBtn= document.getElementById('accurateBtn');
const splash     = document.getElementById('splash');
const splashFill = document.getElementById('splashFill');
const splashMsg  = document.getElementById('splashStatus');
const soundOn    = document.getElementById('soundIconOn');
const soundOff   = document.getElementById('soundIconOff');
const iconSun    = document.getElementById('iconSun');
const iconMoon   = document.getElementById('iconMoon');

/* ── State ── */
let tfModel       = null;
let playing       = false;
let stream        = null;
let facingMode    = 'environment';
let rafId         = null;
let isDetecting   = false;
let soundEnabled  = false;
let currentMode   = 'fast';
let frameIdx      = 0;
let fpsTick       = 0;
let lastFpsStamp  = performance.now();
let audioCtx      = null;
let prevClasses   = new Set();

/* ── Detection mode config ── */
const MODES = {
    fast:     { skip: 6, conf: 0.55, label: '⚡ FAST',     confLabel: '≥55%' },
    accurate: { skip: 2, conf: 0.50, label: '🎯 ACCURATE', confLabel: '≥50%' },
};

/* ── Per-class accent colours ── */
const CLASS_HUE = {
    person:     '#00d4ff',  // cyan
    car:        '#ffb800',  // amber
    bicycle:    '#39ff14',  // lime
    motorcycle: '#ff2d55',  // red
    truck:      '#ff6b00',  // orange
    bus:        '#a855f7',  // purple
    cat:        '#ec4899',  // pink
    dog:        '#f97316',  // orange-warm
    bottle:     '#6366f1',  // indigo
    cup:        '#14b8a6',  // teal
    cell_phone: '#84cc16',  // chartreuse
    laptop:     '#0ea5e9',  // sky
    chair:      '#e879f9',  // fuchsia
    book:       '#fb923c',  // light orange
    clock:      '#facc15',  // yellow
    tvmonitor:  '#22d3ee',  // light cyan
    keyboard:   '#a3e635',
    mouse:      '#34d399',
};
const DEFAULT_COLOR = '#94a3b8';

function colorOf(cls) {
    return CLASS_HUE[cls.toLowerCase().replace(' ', '_')] || DEFAULT_COLOR;
}

/* ═══════════════════════════════════════════════
   CLOCK
   ═══════════════════════════════════════════════ */
setInterval(() => {
    clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

/* ═══════════════════════════════════════════════
   STATUS HELPERS
   ═══════════════════════════════════════════════ */
function setDot(state) {
    dot.className = 'dot ' + state;
    const labels = {
        loading:  'Loading model…',
        ready:    'Ready',
        scanning: 'Detecting objects…',
        error:    'Model error',
    };
    aiStatus.textContent = labels[state] ?? state;
}

function setSplash(pct, msg) {
    splashFill.style.width = pct + '%';
    splashMsg.textContent  = msg;
}

function hideSplash() {
    splash.classList.add('gone');
}

/* ═══════════════════════════════════════════════
   LOAD AI MODEL
   ═══════════════════════════════════════════════ */
async function initModel() {
    setDot('loading');
    setSplash(10, 'Loading TensorFlow.js runtime…');

    try {
        await tf.ready();
        setSplash(40, 'Downloading COCO-SSD (lite)…');

        // Use lite_mobilenet_v2 – fastest & lowest memory
        tfModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });

        setSplash(95, 'Warming up…');
        setDot('ready');
        aiToggle.disabled = false;
        modelStat.textContent = 'Ready';

        setSplash(100, 'Ready!');
        setTimeout(hideSplash, 550);
    } catch (err) {
        console.error('Model load failed:', err);
        setDot('error');
        modelStat.textContent = 'Error';
        setSplash(100, 'Failed to load model.');
        setTimeout(hideSplash, 1800);
    }
}
initModel();

/* ═══════════════════════════════════════════════
   CAMERA – START / STOP
   ═══════════════════════════════════════════════ */
async function startCamera() {
    camLoading.classList.add('show');
    if (stream) stream.getTracks().forEach(t => t.stop());

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
        });

        video.srcObject = stream;
        await video.play();   // required for Safari / iOS

        video.onloadeddata = () => {
            playing = true;
            camLoading.classList.remove('show');

            viewport.classList.add('live');
            liveBadge.classList.remove('hidden');
            confBadge.classList.remove('hidden');
            modeBadge.classList.remove('hidden');

            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            flipBtn.disabled = false;
            snapBtn.disabled = false;

            frameIdx = 0;
            detectLoop();
        };
    } catch (err) {
        camLoading.classList.remove('show');
        console.error(err);
        alert('Camera error!\nPlease allow camera access and make sure the page runs on HTTPS.');
    }
}

function stopCamera() {
    playing = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (rafId)  cancelAnimationFrame(rafId);

    video.srcObject = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    viewport.classList.remove('live', 'scanning');
    liveBadge.classList.add('hidden');
    confBadge.classList.add('hidden');
    modeBadge.classList.add('hidden');

    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    flipBtn.disabled = true;
    snapBtn.disabled = true;

    fpsDisplay.textContent = '0';
    objCount.textContent   = '0';
    updateTypePills([]);
    setDot('ready');
}

/* ═══════════════════════════════════════════════
   DETECTION LOOP
   ═══════════════════════════════════════════════ */
async function detectLoop() {
    if (!playing) return;

    if (video.readyState === 4) {
        /* Keep canvas synced to actual video resolution */
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
        }

        /* FPS counter */
        const now = performance.now();
        fpsTick++;
        if (now - lastFpsStamp >= 1000) {
            fpsDisplay.textContent = fpsTick;
            fpsTick       = 0;
            lastFpsStamp  = now;
        }

        const cfg = MODES[currentMode];
        frameIdx++;

        if (aiToggle.checked && tfModel && !isDetecting && frameIdx % cfg.skip === 0) {
            isDetecting = true;
            viewport.classList.add('scanning');
            setDot('scanning');

            try {
                const raw  = await tfModel.detect(video);
                const preds = raw.filter(p => p.score >= cfg.conf);

                drawBoxes(preds);
                updateTypePills(preds);
                alertNewObjects(preds);

                /* Animate object count */
                const n = preds.length;
                objCount.textContent = n;
                if (n > 0) {
                    objCount.classList.add('pop');
                    setTimeout(() => objCount.classList.remove('pop'), 180);
                }
            } catch (e) {
                console.error('Detection error:', e);
            }

            isDetecting = false;

        } else if (!aiToggle.checked) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            objCount.textContent = '0';
            updateTypePills([]);
            viewport.classList.remove('scanning');
            setDot('ready');
        }
    }

    rafId = requestAnimationFrame(detectLoop);
}

/* ═══════════════════════════════════════════════
   DRAW BOUNDING BOXES
   ═══════════════════════════════════════════════ */
function drawBoxes(preds) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    preds.forEach(pred => {
        const [x, y, w, h] = pred.bbox;
        const color  = colorOf(pred.class);
        const conf   = (pred.score * 100).toFixed(1);
        const label  = `${pred.class}  ${conf}%`;
        const cs     = 13;  // corner accent size

        /* ── Faint fill ── */
        ctx.fillStyle   = color;
        ctx.globalAlpha = 0.06;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;

        /* ── Box outline with glow ── */
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 10;
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur  = 0;

        /* ── L-shaped corner accents ── */
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2.5;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        // top-left
        ctx.moveTo(x + cs, y);
        ctx.lineTo(x,      y);
        ctx.lineTo(x,      y + cs);
        // top-right
        ctx.moveTo(x + w - cs, y);
        ctx.lineTo(x + w,      y);
        ctx.lineTo(x + w,      y + cs);
        // bottom-left
        ctx.moveTo(x,      y + h - cs);
        ctx.lineTo(x,      y + h);
        ctx.lineTo(x + cs, y + h);
        // bottom-right
        ctx.moveTo(x + w - cs, y + h);
        ctx.lineTo(x + w,      y + h);
        ctx.lineTo(x + w,      y + h - cs);
        ctx.stroke();
        ctx.shadowBlur  = 0;

        /* ── Label pill ── */
        ctx.font = 'bold 12.5px Inter, sans-serif';
        const tw = ctx.measureText(label).width;
        const pw = tw + 14;
        const ph = 21;
        const px = x;
        const py = y > ph + 4 ? y - ph - 3 : y + 3;

        // pill bg
        ctx.fillStyle   = color;
        ctx.globalAlpha = 0.92;
        roundRect(ctx, px, py, pw, ph, 5);
        ctx.fill();
        ctx.globalAlpha = 1;

        // pill text
        ctx.fillStyle = '#000';
        ctx.shadowBlur = 0;
        ctx.fillText(label, px + 7, py + ph - 6);
    });
}

/** Draw a rounded rectangle path (no fill/stroke call here) */
function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y,         x + r, y);
    ctx.closePath();
}

/* ═══════════════════════════════════════════════
   OBJECT TYPE PILL PANEL
   ═══════════════════════════════════════════════ */
function updateTypePills(preds) {
    if (!preds || preds.length === 0) {
        typePanel.innerHTML = '<span class="type-empty">No objects detected</span>';
        return;
    }

    // Count by class
    const counts = {};
    preds.forEach(p => { counts[p.class] = (counts[p.class] || 0) + 1; });

    typePanel.innerHTML = Object.entries(counts)
        .map(([cls, n]) => {
            const c = colorOf(cls);
            return `<span class="type-tag" style="
                background:${c}18;
                border:1px solid ${c}38;
                color:${c};
            ">${cls}<span class="tag-count" style="background:${c}28">${n}</span></span>`;
        })
        .join('');
}

/* ═══════════════════════════════════════════════
   SOUND ALERT  (Web Audio API – no external dep)
   ═══════════════════════════════════════════════ */
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playBeep() {
    if (!audioCtx || !soundEnabled) return;
    try {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.frequency.setValueAtTime(900, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(450, audioCtx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.28);

        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.28);
    } catch (e) { /* AudioContext may be suspended on some browsers */ }
}

function alertNewObjects(preds) {
    const current = new Set(preds.map(p => p.class));
    let hasNew = false;
    for (const cls of current) {
        if (!prevClasses.has(cls)) { hasNew = true; break; }
    }
    if (hasNew) playBeep();
    prevClasses = current;
}

/* ═══════════════════════════════════════════════
   SNAPSHOT
   ═══════════════════════════════════════════════ */
function takeSnapshot() {
    const snap  = document.createElement('canvas');
    snap.width  = canvas.width;
    snap.height = canvas.height;
    const sCtx  = snap.getContext('2d');

    // Merge video frame + annotation canvas
    sCtx.drawImage(video,   0, 0, snap.width, snap.height);
    sCtx.drawImage(canvas,  0, 0);

    // White flash feedback
    const flash = document.createElement('div');
    flash.className = 'snap-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 450);

    // Trigger download
    const a    = document.createElement('a');
    a.download = `ai_cam_${Date.now()}.png`;
    a.href     = snap.toDataURL('image/png');
    a.click();
}

/* ═══════════════════════════════════════════════
   THEME TOGGLE
   ═══════════════════════════════════════════════ */
function toggleTheme() {
    const html   = document.documentElement;
    const isDark = html.dataset.theme !== 'light';
    html.dataset.theme = isDark ? 'light' : 'dark';

    // Swap icon
    iconSun.classList.toggle('hidden',  isDark);
    iconMoon.classList.toggle('hidden', !isDark);
}

/* ═══════════════════════════════════════════════
   MODE SWITCH
   ═══════════════════════════════════════════════ */
function setMode(mode) {
    currentMode = mode;
    const cfg   = MODES[mode];

    fastBtn.classList.toggle('active',     mode === 'fast');
    accurateBtn.classList.toggle('active', mode === 'accurate');

    modeBadge.textContent = cfg.label;
    confBadge.textContent = cfg.confLabel;
}

/* ═══════════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════════ */
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click',  stopCamera);

flipBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
});

snapBtn.addEventListener('click', takeSnapshot);

soundBtn.addEventListener('click', () => {
    initAudio();  // must be triggered by user gesture
    soundEnabled = !soundEnabled;

    soundOn.classList.toggle('hidden',  !soundEnabled);
    soundOff.classList.toggle('hidden',  soundEnabled);
    soundBtn.classList.toggle('active',  soundEnabled);
    soundBtn.title = soundEnabled ? 'Sound alerts: ON' : 'Sound alerts: OFF';
});

themeBtn.addEventListener('click', toggleTheme);

fastBtn.addEventListener('click',     () => setMode('fast'));
accurateBtn.addEventListener('click', () => setMode('accurate'));

/* Prevent accidental page-scroll on touch */
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });