// Force WebSocket only — skip polling to prevent reconnection flickers
const socket = io({ transports: ['websocket'], reconnectionDelay: 2000, reconnectionAttempts: Infinity });
const display         = document.getElementById('display');
const idleScreen      = document.getElementById('idle-screen');
const videoPlayer     = document.getElementById('video-player');

let currentFile = null;

// Unmute on first interaction — no overlay needed
document.addEventListener('click',   () => { videoPlayer.muted = false; }, { once: true });
document.addEventListener('keydown', () => { videoPlayer.muted = false; }, { once: true });

// ── Socket ───────────────────────────────────────────────
socket.on('connect', () => socket.emit('request_state'));

socket.on('show_item', (data) => {
    if (!data.running) { showIdle(); return; }
    hideIdle();
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
