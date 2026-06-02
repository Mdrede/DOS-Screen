import os
import time
import threading
import socket
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dos-screen-secret-key'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media')
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

ALLOWED_IMAGES = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
ALLOWED_VIDEOS = {'mp4', 'webm', 'mov', 'avi'}

state = {
    'running': False,
    'playlist': [],
    'current_index': 0,
    'current_started_at': None,
    'image_duration': 5,
    'thread': None,
    'lock': threading.Lock()
}

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

def slideshow_thread():
    while state['running'] and state['playlist']:
        with state['lock']:
            if not state['running']:
                break
            item = state['playlist'][state['current_index']]
            state['current_started_at'] = time.time()
            current = get_current_item()

        socketio.emit('show_item', current)

        duration = item.get('duration', state['image_duration'])
        start = time.time()
        while time.time() - start < duration:
            if not state['running']:
                return
            time.sleep(0.1)

        with state['lock']:
            if state['running'] and state['playlist']:
                state['current_index'] = (state['current_index'] + 1) % len(state['playlist'])

@app.route('/')
def screen():
    return render_template('screen.html')

@app.route('/admin')
def admin():
    return render_template('admin.html')

@app.route('/api/media')
def api_media():
    img_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'images')
    vid_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'videos')
    images = sorted([f for f in os.listdir(img_dir) if allowed_image(f)]) if os.path.exists(img_dir) else []
    videos = sorted([f for f in os.listdir(vid_dir) if allowed_video(f)]) if os.path.exists(vid_dir) else []
    return jsonify({'images': images, 'videos': videos})

@app.route('/api/status')
def api_status():
    return jsonify(get_current_item())

@app.route('/api/playlist', methods=['POST'])
def api_set_playlist():
    data = request.json
    state['playlist'] = data.get('playlist', [])
    state['image_duration'] = data.get('image_duration', 5)
    return jsonify({'status': 'ok', 'count': len(state['playlist'])})

@app.route('/api/start', methods=['POST'])
def api_start():
    if not state['playlist']:
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
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@socketio.on('connect')
def on_connect():
    emit('show_item', get_current_item())

@socketio.on('request_state')
def on_request_state():
    emit('show_item', get_current_item())

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

    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
