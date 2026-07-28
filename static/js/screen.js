// Force WebSocket only — skip polling to prevent reconnection flickers
const socket = io({ transports: ['websocket'], reconnectionDelay: 2000, reconnectionAttempts: Infinity });
const display         = document.getElementById('display');
const idleScreen      = document.getElementById('idle-screen');
const videoPlayer     = document.getElementById('video-player');
const countdownScreen = document.getElementById('countdown-screen');

let currentFile = null;
let countdownInterval = null;
let progressInterval  = null;

// Unmute on first interaction — no overlay needed
document.addEventListener('click',   () => { videoPlayer.muted = false; }, { once: true });
document.addEventListener('keydown', () => { videoPlayer.muted = false; }, { once: true });

// ── Countdown ────────────────────────────────────────────
socket.on('show_countdown', (data) => {
    startCountdown(data.target_date);
    startProgressBar(data.campaign_start, data.target_date);
    countdownScreen.classList.remove('hidden');
    idleScreen.classList.add('hidden');
});

socket.on('hide_countdown', () => {
    countdownScreen.classList.add('hidden');
    clearInterval(countdownInterval);
    clearInterval(progressInterval);
});

function startProgressBar(campaignStart, targetDate) {
    clearInterval(progressInterval);
    const start  = new Date(campaignStart).getTime();
    const target = new Date(targetDate).getTime();
    const total  = target - start;

    function update() {
        const elapsed = Date.now() - start;
        const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
        document.getElementById('cd-progress-bar').style.width = pct + '%';
        document.getElementById('cd-progress-pct').textContent = Math.floor(pct) + '%';
    }

    update();
    progressInterval = setInterval(update, 60000);
}

function startCountdown(targetDate) {
    clearInterval(countdownInterval);
    const target = new Date(targetDate).getTime();

    function update() {
        const now = Date.now();
        const diff = target - now;

        if (diff <= 0) {
            document.getElementById('cd-days').textContent    = '00';
            document.getElementById('cd-hours').textContent   = '00';
            document.getElementById('cd-minutes').textContent = '00';
            document.getElementById('cd-seconds').textContent = '00';
            return;
        }

        const days    = Math.floor(diff / 86400000);
        const hours   = Math.floor((diff % 86400000) / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        setUnit('cd-days',    days);
        setUnit('cd-hours',   hours);
        setUnit('cd-minutes', minutes);
        setUnit('cd-seconds', seconds);
    }

    function setUnit(id, value) {
        const el = document.getElementById(id);
        const str = String(value).padStart(2, '0');
        if (el.textContent !== str) {
            el.textContent = str;
            el.classList.remove('tick');
            void el.offsetWidth; // force reflow
            el.classList.add('tick');
            setTimeout(() => el.classList.remove('tick'), 150);
        }
    }

    update();
    countdownInterval = setInterval(update, 1000);
}

// ── Socket ───────────────────────────────────────────────
socket.on('connect', () => socket.emit('request_state'));

socket.on('show_item', (data) => {
    if (!data.running) { showIdle(); return; }
    hideIdle();
    countdownScreen.classList.add('hidden');
    clearInterval(countdownInterval);
    if (data.type === 'image') showImage(data.file);
    else if (data.type === 'video') showVideo(data.file, data.started_at);
});

// ── Idle ─────────────────────────────────────────────────
function hideIdle() { idleScreen.classList.add('hidden'); }

function showIdle() {
    currentFile = null;
    display.innerHTML = '';
    videoPlayer.classList.add('hidden');
    videoPlayer.removeAttribute('src');
    idleScreen.classList.remove('hidden');
}

// ── Images ───────────────────────────────────────────────
function showImage(filename) {
    if (currentFile === filename) return;
    currentFile = filename;

    // Hide video without pausing so autoplay stays unlocked
    videoPlayer.classList.add('hidden');

    const oldSlide = display.querySelector('.slide:not(.exiting)');
    if (oldSlide) {
        oldSlide.classList.add('exiting');
        oldSlide.addEventListener('animationend', () => oldSlide.remove(), { once: true });
    }

    const img = document.createElement('img');
    img.className = 'slide entering';
    img.src = `/media/images/${encodeURIComponent(filename)}`;
    img.addEventListener('animationend', () => img.classList.remove('entering'), { once: true });
    img.addEventListener('error', () => img.remove());
    display.appendChild(img);
}

// ── Video ────────────────────────────────────────────────
function showVideo(filename, startedAt) {
    display.innerHTML = '';

    if (currentFile === filename) return;
    currentFile = filename;

    videoPlayer.classList.remove('hidden');
    videoPlayer.src = `/media/videos/${encodeURIComponent(filename)}`;
    videoPlayer.load();

    videoPlayer.addEventListener('loadedmetadata', () => {
        // Report duration to server so it knows when to advance
        socket.emit('video_duration', { duration: videoPlayer.duration });
    }, { once: true });

    videoPlayer.addEventListener('canplay', () => {
        videoPlayer.play()
            .then(() => {
                const elapsed = (Date.now() / 1000) - startedAt;
                if (elapsed > 1 && elapsed < videoPlayer.duration) {
                    videoPlayer.currentTime = elapsed;
                }
            })
            .catch(() => {});
    }, { once: true });

    // Tell server when video ends so it advances playlist
    videoPlayer.addEventListener('ended', () => {
        socket.emit('video_ended');
    }, { once: true });
}
