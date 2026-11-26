import os
import requests
import zipfile
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

FFMPEG_DIR = "ffmpeg-bin"
FFMPEG_EXE = os.path.join(FFMPEG_DIR, "ffmpeg.exe")


def download_ffmpeg():
    """Downloads a portable FFmpeg build if missing."""
    if os.path.exists(FFMPEG_EXE):
        return

    print("Downloading FFmpeg (Windows portable)...")
    url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    zip_path = "ffmpeg.zip"

    r = requests.get(url)
    with open(zip_path, "wb") as f:
        f.write(r.content)

    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall("temp_ffmpeg")

    # find ffmpeg.exe
    for root, dirs, files in os.walk("temp_ffmpeg"):
        if "ffmpeg.exe" in files:
            os.makedirs(FFMPEG_DIR, exist_ok=True)
            src = os.path.join(root, "ffmpeg.exe")
            os.rename(src, FFMPEG_EXE)
            break

    # cleanup
    os.remove(zip_path)
    import shutil
    shutil.rmtree("temp_ffmpeg")

    print("FFmpeg downloaded successfully!")


@app.route("/convert", methods=["POST"])
def convert_audio():
    download_ffmpeg()

    file = request.files["file"]
    output_format = request.form["format"]

    input_path = "input.tmp"
    output_path = f"output.{output_format}"

    file.save(input_path)

    os.system(f'"{FFMPEG_EXE}" -i "{input_path}" "{output_path}" -y')

    return send_file(output_path, as_attachment=True)


if __name__ == "__main__":
    app.run(port=5000, debug=True)
