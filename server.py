import os
import re
import time
import threading
import socket
import mimetypes
import json
from flask import Flask, render_template, request, jsonify, send_from_directory, Response
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename

SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'settings.json')

def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_settings(data):
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dos-screen-secret-key'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media')
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading',
                    ping_interval=60, ping_timeout=120)

ALLOWED_IMAGES = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
ALLOWED_VIDEOS = {'mp4', 'webm', 'mov', 'avi'}

state = {
    'running': False,
    'playlist': [],
    'current_index': 0,
    'current_started_at': None,
    'image_duration': 5,
    'thread': None,
    'lock': threading.Lock(),
    'video_done': threading.Event(),
    'screen2_last': None
}

countdown = {
    'enabled': True,
    'target_date': '2026-06-17T00:00:00',
    'campaign_start': '2026-06-01T00:00:00',  # when countdown campaign began
    'restaurant_name': 'DOS BURGER',
    'show_duration': 30,
    'countdown_only': False
}

screen2 = {
    'text': ''
}

pic_loop = {
    'enabled': False
}

fixed_pic = {
    'enabled': False,
    'file': None
}

# Load saved settings
_saved = load_settings()
if 'playlist' in _saved:
    state['playlist'] = _saved['playlist']
if 'image_duration' in _saved:
    state['image_duration'] = _saved['image_duration']
if 'countdown' in _saved:
    countdown.update(_saved['countdown'])
if 'screen2' in _saved:
    screen2.update(_saved['screen2'])
if 'pic_loop' in _saved:
    pic_loop.update(_saved['pic_loop'])
if 'fixed_pic' in _saved:
    fixed_pic.update(_saved['fixed_pic'])

def persist_settings():
    save_settings({
        'playlist': state['playlist'],
        'image_duration': state['image_duration'],
        'countdown': countdown,
        'screen2': screen2,
        'pic_loop': pic_loop,
        'fixed_pic': fixed_pic
    })

def allowed_image(f): return '.' in f and f.rsplit('.', 1)[1].lower() in ALLOWED_IMAGES
def allowed_video(f): return '.' in f and f.rsplit('.', 1)[1].lower() in ALLOWED_VIDEOS

def get_current_item():
    if not state['running'] or not state['playlist']:
        return {'running': False}
    item = state['playlist'][state['current_index']]
    return {
        'running': True,
        'type': item['type'],
        'file': item['file'],
        'started_at': state['current_started_at'],
        'index': state['current_index'],
        'total': len(state['playlist'])
    }

def get_fixed_pic_item():
    return {'running': True, 'type': 'image', 'file': fixed_pic['file'], 'index': 0, 'total': 1}

def slideshow_thread():
    # Fixed picture mode — show one image forever, no looping
    if fixed_pic.get('enabled') and fixed_pic.get('file'):
        socketio.emit('show_item', get_fixed_pic_item())
        while state['running']:
            time.sleep(1)
        return

    # Countdown-only mode — show countdown forever, no playlist
    if countdown.get('countdown_only') and countdown.get('enabled'):
        socketio.emit('show_countdown', countdown)
        while state['running']:
            time.sleep(1)
        return

    while state['running'] and state['playlist']:

        # Show countdown at the start of every loop
        if countdown['enabled'] and state['current_index'] == 0:
            socketio.emit('show_countdown', countdown)
            elapsed = 0
            while elapsed < countdown['show_duration'] and state['running']:
                time.sleep(0.2)
                elapsed += 0.2
            if not state['running']:
                return
            socketio.emit('hide_countdown', {})

        with state['lock']:
            if not state['running']:
                break
            item = state['playlist'][state['current_index']]
            state['current_started_at'] = time.time()
            current = get_current_item()

        socketio.emit('show_item', current)

        if item['type'] == 'video':
            # Wait for client to signal video finished
            state['video_done'].clear()
            timeout = item.get('duration', 0)
            timeout = timeout if timeout > 5 else 3600  # fallback 1hr if duration unknown
            state['video_done'].wait(timeout=timeout)
        else:
            duration = item.get('duration', state['image_duration'])
            start = time.time()
            while time.time() - start < duration:
                if not state['running']:
                    return
                time.sleep(0.1)

        # Send finished image to screen 2 if pic loop is on
        if pic_loop.get('enabled') and item['type'] == 'image':
            state['screen2_last'] = current
            socketio.emit('show_item_screen2', current)

        with state['lock']:
            if state['running'] and state['playlist']:
                state['current_index'] = (state['current_index'] + 1) % len(state['playlist'])

@app.route('/')
def screen():
    return render_template('screen.html')

@app.route('/admin')
def admin():
    return render_template('admin.html')

@app.route('/2')
def screen2_page():
    return render_template('screen2.html')

@app.route('/api/screen2', methods=['GET'])
def get_screen2():
    return jsonify(screen2)

@app.route('/api/screen2', methods=['POST'])
def set_screen2():
    data = request.json
    screen2.update(data)
    persist_settings()
    return jsonify({'status': 'ok'})

@app.route('/api/media')
def api_media():
    img_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'images')
    vid_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'videos')
    images = sorted([f for f in os.listdir(img_dir) if allowed_image(f)]) if os.path.exists(img_dir) else []
    videos = sorted([f for f in os.listdir(vid_dir) if allowed_video(f)]) if os.path.exists(vid_dir) else []
    return jsonify({'images': images, 'videos': videos})

@app.route('/api/status')
def api_status():
    if state['running'] and fixed_pic.get('enabled') and fixed_pic.get('file'):
        return jsonify(get_fixed_pic_item())
    return jsonify(get_current_item())

@app.route('/api/playlist', methods=['POST'])
def api_set_playlist():
    data = request.json
    state['playlist'] = data.get('playlist', [])
    state['image_duration'] = data.get('image_duration', 5)
    persist_settings()
    return jsonify({'status': 'ok', 'count': len(state['playlist'])})

@app.route('/api/countdown', methods=['GET'])
def get_countdown():
    return jsonify(countdown)

@app.route('/api/countdown', methods=['POST'])
def set_countdown():
    data = request.json
    countdown.update(data)
    persist_settings()
    return jsonify({'status': 'ok'})

@app.route('/api/start', methods=['POST'])
def api_start():
    fixed_pic_ready = fixed_pic.get('enabled') and fixed_pic.get('file')
    if not state['playlist'] and not countdown.get('countdown_only') and not fixed_pic_ready:
        return jsonify({'error': 'Playlist is empty. Add items first.'}), 400
    state['running'] = False
    if state['thread'] and state['thread'].is_alive():
        state['thread'].join(timeout=2)
    state['current_index'] = 0
    state['running'] = True
    state['thread'] = threading.Thread(target=slideshow_thread, daemon=True)
    state['thread'].start()
    return jsonify({'status': 'started'})

@app.route('/api/stop', methods=['POST'])
def api_stop():
    state['running'] = False
    socketio.emit('show_item', {'running': False})
    return jsonify({'status': 'stopped'})

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'No filename'}), 400
    filename = secure_filename(file.filename)
    if allowed_image(filename):
        save_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'images')
        file_type = 'image'
    elif allowed_video(filename):
        save_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'videos')
        file_type = 'video'
    else:
        return jsonify({'error': 'File type not supported. Use JPG, PNG, MP4, MOV.'}), 400
    os.makedirs(save_dir, exist_ok=True)
    file.save(os.path.join(save_dir, filename))
    return jsonify({'status': 'ok', 'file': filename, 'type': file_type})

@app.route('/media/<path:filename>')
def serve_media(filename):
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(file_path):
        return "Not found", 404

    mime = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
    file_size = os.path.getsize(file_path)
    range_header = request.headers.get('Range')

    if range_header:
        match = re.search(r'bytes=(\d+)-(\d*)', range_header)
        byte_start = int(match.group(1)) if match else 0
        byte_end = int(match.group(2)) if match and match.group(2) else file_size - 1
        byte_end = min(byte_end, file_size - 1)
        length = byte_end - byte_start + 1

        def generate():
            with open(file_path, 'rb') as f:
                f.seek(byte_start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        resp = Response(generate(), 206, mimetype=mime, direct_passthrough=True)
        resp.headers['Content-Range'] = f'bytes {byte_start}-{byte_end}/{file_size}'
        resp.headers['Accept-Ranges'] = 'bytes'
        resp.headers['Content-Length'] = length
        return resp

    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/pic_loop', methods=['GET'])
def get_pic_loop():
    return jsonify(pic_loop)

@app.route('/api/pic_loop', methods=['POST'])
def set_pic_loop():
    data = request.json
    pic_loop.update(data)
    persist_settings()
    socketio.emit('screen2_init', {'text': screen2.get('text', ''), 'pic_loop': pic_loop.get('enabled', False)})
    return jsonify({'status': 'ok'})

@app.route('/api/fixed_pic', methods=['GET'])
def get_fixed_pic():
    return jsonify(fixed_pic)

@app.route('/api/fixed_pic', methods=['POST'])
def set_fixed_pic():
    data = request.json
    fixed_pic.update(data)
    persist_settings()
    return jsonify({'status': 'ok'})

@socketio.on('connect')
def on_connect():
    if state['running'] and fixed_pic.get('enabled') and fixed_pic.get('file'):
        emit('show_item', get_fixed_pic_item())
    elif state['running'] and countdown.get('enabled') and countdown.get('countdown_only'):
        emit('show_countdown', countdown)
    else:
        emit('show_item', get_current_item())

@socketio.on('join_screen2')
def on_join_screen2():
    data = {'text': screen2.get('text', ''), 'pic_loop': pic_loop.get('enabled', False)}
    if pic_loop.get('enabled') and state.get('screen2_last'):
        data['last_item'] = state['screen2_last']
    emit('screen2_init', data)

@socketio.on('request_state')
def on_request_state():
    if state['running'] and fixed_pic.get('enabled') and fixed_pic.get('file'):
        emit('show_item', get_fixed_pic_item())
    elif state['running'] and countdown.get('enabled') and countdown.get('countdown_only'):
        emit('show_countdown', countdown)
    else:
        emit('show_item', get_current_item())

@socketio.on('video_duration')
def on_video_duration(data):
    with state['lock']:
        if state['running'] and state['playlist']:
            item = state['playlist'][state['current_index']]
            if item['type'] == 'video' and item.get('duration', 0) == 0:
                item['duration'] = data.get('duration', 10)

@socketio.on('video_ended')
def on_video_ended():
    # Signal the slideshow thread to advance — thread does the actual advancing
    state['video_done'].set()

if __name__ == '__main__':
    os.makedirs('media/images', exist_ok=True)
    os.makedirs('media/videos', exist_ok=True)

    try:
        local_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        local_ip = '(check your IP)'

    print("\n" + "=" * 54)
    print("    DOS Screen — Restaurant Display System")
    print("=" * 54)
    print(f"    Screen URL  : http://localhost:5000")
    print(f"    Admin Panel : http://localhost:5000/admin")
    print(f"    TV Screens  : http://{local_ip}:5000")
    print("=" * 54)
    print("    Open Admin Panel to manage content")
    print("    Point TV browsers to the TV Screens URL")
    print("=" * 54 + "\n")

    # Auto-start if playlist exists, countdown-only mode is on, or a fixed picture is set
    if state['playlist'] or (countdown.get('enabled') and countdown.get('countdown_only')) or (fixed_pic.get('enabled') and fixed_pic.get('file')):
        state['running'] = True
        state['thread'] = threading.Thread(target=slideshow_thread, daemon=True)
        state['thread'].start()
        print("    Auto-started slideshow.\n")

    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
