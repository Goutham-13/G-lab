from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp
import os
import uuid

app = Flask(__name__)
CORS(app)

DOWNLOAD_FOLDER = "downloads"
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

@app.route("/fetch", methods=["POST"])
def fetch_video():
    data = request.get_json()
    url = data.get("url")
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    # Generate unique filenames
    video_filename = os.path.join(DOWNLOAD_FOLDER, f"{uuid.uuid4()}.mp4")
    audio_filename = os.path.join(DOWNLOAD_FOLDER, f"{uuid.uuid4()}.mp3")

    try:
        # Download video
        ydl_opts_video = {
            "outtmpl": video_filename,
            "format": "bestvideo+bestaudio/best",
            "noplaylist": True
        }
        with yt_dlp.YoutubeDL(ydl_opts_video) as ydl:
            ydl.extract_info(url, download=True)

        # Download audio
        ydl_opts_audio = {
            "outtmpl": audio_filename,
            "format": "bestaudio/best",
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}],
            "noplaylist": True
        }
        with yt_dlp.YoutubeDL(ydl_opts_audio) as ydl:
            ydl.extract_info(url, download=True)

        return jsonify({
            "video_url": f"/download/video/{os.path.basename(video_filename)}",
            "audio_url": f"/download/audio/{os.path.basename(audio_filename)}"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/download/video/<filename>")
def serve_video(filename):
    path = os.path.join(DOWNLOAD_FOLDER, filename)
    if os.path.exists(path):
        return send_file(path, as_attachment=False)
    return "Video not found", 404

@app.route("/download/audio/<filename>")
def serve_audio(filename):
    path = os.path.join(DOWNLOAD_FOLDER, filename)
    if os.path.exists(path):
        return send_file(path, as_attachment=True)
    return "Audio not found", 404

if __name__ == "__main__":
    app.run(debug=True)
