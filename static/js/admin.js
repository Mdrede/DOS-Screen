const socket = io();
let playlist = [];
let mediaLib = { images: [], videos: [] };
let dragSrc = null;

// ── Socket ──────────────────────────────────────────────
socket.on('connect', loadMedia);

socket.on('show_item', (data) => {
    const badge = document.getElementById('status-badge');
    if (data.running) {
        badge.textContent = `Playing (${data.index + 1}/${data.total})`;
        badge.className = 'badge badge-running';
    } else {
        badge.textContent = 'Stopped';
        badge.className = 'badge badge-idle';
    }
});

// ── Media Library ────────────────────────────────────────
async function loadMedia() {
    const res = await fetch('/api/media');
    mediaLib = await res.json();
    renderImages();
    renderVideos();
    renderFixedPicOptions();
}

function renderFixedPicOptions() {
    const sel = document.getElementById('fixed-pic-file');
    const current = sel.value;
    sel.innerHTML = mediaLib.images.map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('');
    if (mediaLib.images.includes(current)) sel.value = current;
}

function renderImages() {
    const el = document.getElementById('image-list');
    if (!mediaLib.images.length) {
        el.innerHTML = '<p style="color:#555;font-size:0.8rem;padding:8px">No images uploaded yet</p>';
        return;
    }
    el.innerHTML = mediaLib.images.map(f => `
        <div class="media-thumb" onclick="addToPlaylist('image','${escHtml(f)}')" title="${escHtml(f)}">
            <img src="/media/images/${encodeURIComponent(f)}" loading="lazy" alt="${escHtml(f)}">
            <div class="thumb-name">${escHtml(f)}</div>
        </div>
    `).join('');
}

function renderVideos() {
    const el = document.getElementById('video-list');
    if (!mediaLib.videos.length) {
        el.innerHTML = '<p style="color:#555;font-size:0.8rem;padding:8px">No videos uploaded yet</p>';
        return;
    }
    el.innerHTML = mediaLib.videos.map(f => `
        <div class="media-row" onclick="addToPlaylist('video','${escHtml(f)}')">
            <span class="icon">🎬</span>
            <span class="name">${escHtml(f)}</span>
            <span class="add-btn">+ Add</span>
        </div>
    `).join('');
}

function switchTab(tab, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
}

// ── Upload ───────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(files) {
    const progress = document.getElementById('upload-progress');
    progress.innerHTML = '';
    for (const file of files) {
        const row = document.createElement('div');
        row.className = 'upload-item';
        row.innerHTML = `<span class="filename">${escHtml(file.name)}</span><span class="status">Uploading...</span>`;
        progress.prepend(row);

        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await fetch('/upload', { method: 'POST', body: fd });
            const data = await res.json();
            const status = row.querySelector('.status');
            if (data.status === 'ok') {
                status.className = 'status ok';
                status.textContent = 'Done';
                if (!mediaLib[data.type + 's'].includes(data.file)) {
                    mediaLib[data.type + 's'].push(data.file);
                    if (data.type === 'image') { renderImages(); renderFixedPicOptions(); }
                    else renderVideos();
                }
            } else {
                status.className = 'status fail';
                status.textContent = data.error || 'Failed';
            }
        } catch {
            row.querySelector('.status').className = 'status fail';
            row.querySelector('.status').textContent = 'Error';
        }
    }
}

// ── Playlist ─────────────────────────────────────────────
function addToPlaylist(type, file) {
    const dur = parseInt(document.getElementById('image-duration').value) || 5;
    playlist.push({ type, file, duration: type === 'image' ? dur : 0 });
    renderPlaylist();
}

function clearPlaylist() {
    playlist = [];
    renderPlaylist();
}

function removeFromPlaylist(index) {
    playlist.splice(index, 1);
    renderPlaylist();
}

function renderPlaylist() {
    const el = document.getElementById('playlist');
    if (!playlist.length) {
        el.innerHTML = '<div class="playlist-empty">No items yet — add from the library</div>';
        return;
    }
    el.innerHTML = playlist.map((item, i) => `
        <div class="playlist-item" draggable="true"
             data-index="${i}"
             ondragstart="dragStart(event,${i})"
             ondragover="dragOver(event)"
             ondrop="dragDrop(event,${i})"
             ondragend="dragEnd()">
            <span class="pl-handle">⠿</span>
            <span class="pl-icon">${item.type === 'image' ? '🖼' : '🎬'}</span>
            <span class="pl-name">${escHtml(item.file)}</span>
            ${item.type === 'image'
                ? `<div class="pl-duration">
                       <input type="number" value="${item.duration}" min="1" max="120"
                              onchange="updateDuration(${i}, this.value)">
                       <span>sec</span>
                   </div>`
                : `<div class="pl-duration video-dur">Full video</div>`
            }
            <button class="pl-remove" onclick="removeFromPlaylist(${i})">✕</button>
        </div>
    `).join('');
}

function updateDuration(index, value) {
    playlist[index].duration = parseInt(value) || 5;
}

// ── Drag & Drop reorder ──────────────────────────────────
function dragStart(e, index) {
    dragSrc = index;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}
function dragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function dragEnd() {
    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('dragging'));
}
function dragDrop(e, index) {
    e.preventDefault();
    if (dragSrc === null || dragSrc === index) return;
    const moved = playlist.splice(dragSrc, 1)[0];
    playlist.splice(index, 0, moved);
    dragSrc = null;
    renderPlaylist();
}

// ── Save / Start / Stop ──────────────────────────────────
async function savePlaylist() {
    const dur = parseInt(document.getElementById('image-duration').value) || 5;
    const res = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist, image_duration: dur })
    });
    const data = await res.json();
    const status = document.getElementById('save-status');
    if (data.status === 'ok') {
        status.textContent = `Saved (${data.count} items)`;
        setTimeout(() => status.textContent = '', 3000);
    }
}

async function startSlideshow() {
    await savePlaylist();
    const res = await fetch('/api/start', { method: 'POST' });
    const data = await res.json();
    if (data.error) alert(data.error);
}

async function stopSlideshow() {
    await fetch('/api/stop', { method: 'POST' });
}

// ── Helpers ──────────────────────────────────────────────
function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Countdown ─────────────────────────────────────────────
async function loadCountdown() {
    const res = await fetch('/api/countdown');
    const data = await res.json();
    document.getElementById('cd-enabled').checked = data.enabled;
    document.getElementById('cd-name').value = data.restaurant_name || 'DOS BURGER';
    document.getElementById('cd-duration').value = data.show_duration || 30;
    document.getElementById('cd-only').checked = data.countdown_only || false;
    if (data.target_date) {
        const d = new Date(data.target_date);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('cd-date').value = local;
    }
    if (data.campaign_start) {
        const d = new Date(data.campaign_start);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('cd-start').value = local;
    }
}

async function saveCountdown() {
    const dateVal = document.getElementById('cd-date').value;
    const payload = {
        enabled:         document.getElementById('cd-enabled').checked,
        restaurant_name: document.getElementById('cd-name').value,
        target_date:     dateVal ? new Date(dateVal).toISOString() : null,
        campaign_start:  document.getElementById('cd-start').value ? new Date(document.getElementById('cd-start').value).toISOString() : null,
        show_duration:   parseInt(document.getElementById('cd-duration').value) || 30,
        countdown_only:  document.getElementById('cd-only').checked
    };
    await fetch('/api/countdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const status = document.getElementById('save-status');
    status.textContent = 'Countdown saved!';
    setTimeout(() => status.textContent = '', 3000);
}

// ── Screen 2 ──────────────────────────────────────────────
async function loadScreen2() {
    const res = await fetch('/api/screen2');
    const data = await res.json();
    document.getElementById('screen2-text').value = data.text || '';
}

async function saveScreen2() {
    const text = document.getElementById('screen2-text').value;
    await fetch('/api/screen2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    const status = document.getElementById('save-status');
    status.textContent = 'Screen 2 saved!';
    setTimeout(() => status.textContent = '', 3000);
}

// ── Pic Loop ──────────────────────────────────────────────
async function loadPicLoop() {
    const res = await fetch('/api/pic_loop');
    const data = await res.json();
    document.getElementById('pic-loop').checked = data.enabled || false;
}

async function savePicLoop() {
    const enabled = document.getElementById('pic-loop').checked;
    await fetch('/api/pic_loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    });
    const status = document.getElementById('save-status');
    status.textContent = enabled ? 'Pic Loop ON' : 'Pic Loop OFF';
    setTimeout(() => status.textContent = '', 3000);
}

// ── Fixed Picture ─────────────────────────────────────────
async function loadFixedPic() {
    const res = await fetch('/api/fixed_pic');
    const data = await res.json();
    document.getElementById('fixed-pic-enabled').checked = data.enabled || false;
    if (data.file) {
        const sel = document.getElementById('fixed-pic-file');
        if (![...sel.options].some(o => o.value === data.file)) {
            const opt = document.createElement('option');
            opt.value = data.file;
            opt.textContent = data.file;
            sel.appendChild(opt);
        }
        sel.value = data.file;
    }
}

async function saveFixedPic() {
    const enabled = document.getElementById('fixed-pic-enabled').checked;
    const file = document.getElementById('fixed-pic-file').value;
    if (enabled && !file) {
        alert('Upload an image first.');
        document.getElementById('fixed-pic-enabled').checked = false;
        return;
    }
    await fetch('/api/fixed_pic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, file })
    });
    const status = document.getElementById('save-status');
    status.textContent = enabled ? 'Fixed Picture ON — click Start to apply' : 'Fixed Picture OFF';
    setTimeout(() => status.textContent = '', 3000);
}

// Init
loadMedia();
loadCountdown();
loadScreen2();
loadPicLoop();
loadFixedPic();
