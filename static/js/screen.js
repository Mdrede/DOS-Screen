const socket = io({ reconnectionDelay: 1000, reconnectionAttempts: Infinity });
const display = document.getElementById('display');
const idleScreen = document.getElementById('idle-screen');

let currentFile = null;

socket.on('connect', () => socket.emit('request_state'));

socket.on('show_item', (data) => {
    if (!data.running) {
        showIdle();
        return;
    }
    hideIdle();
    if (data.type === 'image') showImage(data.file);
    else if (data.type === 'video') showVideo(data.file, data.started_at);
});

socket.on('disconnect', () => {
    // Keep showing last content — don't go idle on brief disconnects
});

function hideIdle() {
    idleScreen.classList.add('hidden');
}

function showIdle() {
    currentFile = null;
    display.innerHTML = '';
    idleScreen.classList.remove('hidden');
}

function showImage(filename) {
    if (currentFile === filename) return;
    currentFile = filename;

    // Exit current slide to the right
    const oldSlide = display.querySelector('.slide:not(.exiting)');
    if (oldSlide) {
        oldSlide.classList.add('exiting');
        oldSlide.addEventListener('animationend', () => oldSlide.remove(), { once: true });
    }

    // Enter new slide from the left
    const img = document.createElement('img');
    img.className = 'slide entering';
    img.src = `/media/images/${encodeURIComponent(filename)}`;
    img.addEventListener('animationend', () => img.classList.remove('entering'), { once: true });
    img.addEventListener('error', () => {
        // If image fails to load, remove it
        img.remove();
    });
    display.appendChild(img);
}

function showVideo(filename, startedAt) {
    if (currentFile === filename) {
        // Already playing — just sync the position
        const existing = display.querySelector('.video-player');
        if (existing) {
            syncVideoTime(existing, startedAt);
        }
        return;
    }
    currentFile = filename;
    display.innerHTML = '';

    const video = document.createElement('video');
    video.className = 'video-player';
    video.src = `/media/videos/${encodeURIComponent(filename)}`;
    video.loop = false;
    video.playsInline = true;

    video.addEventListener('loadedmetadata', () => {
        syncVideoTime(video, startedAt);
        video.play().catch(() => {
            // Autoplay blocked — try muted first
            video.muted = true;
            video.play();
        });
    });

    display.appendChild(video);
}

function syncVideoTime(video, startedAt) {
    const elapsed = (Date.now() / 1000) - startedAt;
    if (elapsed > 0 && video.duration && elapsed < video.duration) {
        video.currentTime = elapsed;
    }
}
