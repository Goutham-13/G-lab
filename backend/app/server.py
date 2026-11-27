"""Unified CleanLab backend: stateless stream-only Link Downloader + static frontend server."""

from __future__ import annotations

import html as html_lib
import importlib.util
import io
import ipaddress
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path

import imageio_ffmpeg
import requests
import yt_dlp
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from flask_cors import CORS
from PIL import Image, ImageOps

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
DOWNLOAD_DIR = APP_DIR / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
NODE_EXE = shutil.which("node")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Ephemeral token -> (temp_file_path, download_name); deleted immediately after serving
READY_FILES: dict[str, tuple[Path, str]] = {}
HTTP_SESSION = requests.Session()

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = None
# Allow CORS: in production restrict to the Vercel frontend URL via env var ALLOWED_ORIGIN
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
CORS(app, origins=_ALLOWED_ORIGIN, supports_credentials=False)


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # Sanitize ALL response headers to ASCII so Waitress never throws
    # UnicodeEncodeError('latin-1') when upstream servers return Unicode values
    for key in list(response.headers.keys()):
        val = response.headers[key]
        if isinstance(val, str):
            safe = val.encode("ascii", "ignore").decode("ascii")
            if safe != val:
                response.headers[key] = safe
    return response


def cleanup_old_downloads(max_age_sec: int = 300) -> None:
    """Ensure no temporary files linger on disk."""
    now = time.time()
    stale = [tok for tok, (p, _) in READY_FILES.items() if not p.exists() or now - p.stat().st_mtime > max_age_sec]
    for tok in stale:
        READY_FILES.pop(tok, None)
    for item in DOWNLOAD_DIR.iterdir():
        try:
            if item.is_file() and now - item.stat().st_mtime > max_age_sec:
                item.unlink(missing_ok=True)
        except OSError:
            pass


def sanitize_filename(name: str, fallback: str = "download") -> str:
    # Strip non-ASCII first so latin-1 header encoding never fails
    name = (name or "").encode("ascii", "ignore").decode("ascii")
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name.strip())
    clean = re.sub(r"\s+", " ", clean).strip(" .")
    return clean[:110] or fallback


def validate_http_url(url: str) -> str:
    url = (url or "").strip()
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").strip().lower()
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not host:
        raise ValueError("Please enter a valid http:// or https:// link.")
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal")):
        raise ValueError("Private or local network URLs are not permitted.")

    def _is_blocked_ip(ip_str: str) -> bool:
        ip_obj = ipaddress.ip_address(ip_str)
        return (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        )

    try:
        if _is_blocked_ip(host):
            raise ValueError("Private or local network URLs are not permitted.")
    except ValueError as exc:
        if "Private or local" in str(exc):
            raise
        try:
            for info in socket.getaddrinfo(host, None):
                addr = info[4][0].split("%")[0]
                if _is_blocked_ip(addr):
                    raise ValueError("Private or local network URLs are not permitted.")
        except socket.gaierror:
            pass
    return url


def classify_content_type(content_type: str, url: str) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    ext = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if ct.startswith("image/") or ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"}:
        return "image"
    if ct.startswith("video/") or ext in {".mp4", ".webm", ".mov", ".mkv", ".m4v"}:
        return "video"
    if ct.startswith("audio/") or ext in {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"}:
        return "audio"
    if ct == "application/pdf" or ext == ".pdf":
        return "pdf"
    if ct in {"text/html", "application/xhtml+xml"}:
        return "html"
    return "file"


def format_duration(seconds: float | int | None) -> str:
    if not seconds:
        return ""
    sec = int(seconds)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def base_ydl_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "ffmpeg_location": FFMPEG_EXE,
    }
    if NODE_EXE:
        opts["js_runtimes"] = {"node": {}}
    return opts


def build_image_options(target_url: str, orig_ext: str) -> list[dict]:
    ext_upper = (orig_ext or "img").upper()
    opts = [
        {"id": "direct_url", "targetUrl": target_url, "label": f"Original Image ({ext_upper})", "ext": orig_ext or "jpg", "kind": "image"},
    ]
    for fmt in ("png", "jpg", "webp"):
        if fmt != (orig_ext or "").lower() and not (fmt == "jpg" and (orig_ext or "").lower() == "jpeg"):
            opts.append({"id": f"img_{fmt}", "targetUrl": target_url, "label": f"Convert to {fmt.upper()}", "ext": fmt, "kind": "image"})
    return opts


def build_audio_options(target_url: str, orig_ext: str) -> list[dict]:
    ext_upper = (orig_ext or "audio").upper()
    opts = [
        {"id": "direct_url", "targetUrl": target_url, "label": f"Original Audio ({ext_upper})", "ext": orig_ext or "mp3", "kind": "audio"},
    ]
    for fmt in ("mp3", "m4a", "wav"):
        if fmt != (orig_ext or "").lower():
            opts.append({"id": f"direct_audio_{fmt}", "targetUrl": target_url, "label": f"Convert to {fmt.upper()}", "ext": fmt, "kind": "audio"})
    return opts


def proxy_url_for(raw_url: str) -> str:
    return f"/api/preview?url={urllib.parse.quote(raw_url, safe='')}"


def extract_twitter_fx_fallback(url: str) -> dict | None:
    """Resolve X/Twitter posts (videos, GIFs, and photos) via fxtwitter API when needed."""
    m = re.match(r"https?://(?:www\.|mobile\.)?(?:twitter\.com|x\.com)/([^/]+)/status/(\d+)", url, re.IGNORECASE)
    if not m:
        return None
    user, status_id = m.group(1), m.group(2)
    try:
        r = requests.get(f"https://api.fxtwitter.com/{user}/status/{status_id}", headers={"User-Agent": USER_AGENT}, timeout=10)
        if r.status_code != 200:
            return None
        payload = r.json()
    except Exception:
        return None

    tweet = payload.get("tweet") or {}
    media = tweet.get("media") or {}
    videos = media.get("videos") or []
    photos = media.get("photos") or []
    author = (tweet.get("author") or {}).get("screen_name") or user
    title = (tweet.get("text") or f"Post by @{author}").strip()[:120]

    options = []
    previews = {}
    kind = "webpage"

    if videos:
        vid = videos[0]
        variants = [v for v in (vid.get("variants") or []) if v.get("content_type") == "video/mp4" and v.get("url")]
        variants.sort(key=lambda v: v.get("bitrate") or 0, reverse=True)
        main_vid_url = (variants[0]["url"] if variants else vid.get("url")) or ""
        thumb_url = vid.get("thumbnail_url") or ""

        if main_vid_url:
            kind = "video"
            previews["video"] = proxy_url_for(main_vid_url)
            previews["audio"] = f"/api/convert-audio?url={urllib.parse.quote(main_vid_url, safe='')}&fmt=mp3&inline=1"
            if variants:
                for idx, v in enumerate(variants):
                    kbps = f" ({round((v.get('bitrate') or 0) / 1000)} kbps)" if v.get("bitrate") else ""
                    label = f"Video MP4{kbps}" if idx > 0 else f"Best Video · MP4{kbps}"
                    options.append({"id": "direct_url", "targetUrl": v["url"], "label": label, "ext": "mp4", "kind": "video"})
            else:
                options.append({"id": "direct_url", "targetUrl": main_vid_url, "label": "Video · MP4", "ext": "mp4", "kind": "video"})
            options.append({"id": "direct_audio_mp3", "targetUrl": main_vid_url, "label": "Extract Audio · MP3", "ext": "mp3", "kind": "audio"})
            options.append({"id": "direct_audio_wav", "targetUrl": main_vid_url, "label": "Extract Audio · WAV", "ext": "wav", "kind": "audio"})
        if thumb_url:
            previews["image"] = proxy_url_for(thumb_url)
            options.extend(build_image_options(thumb_url, "jpg"))

    elif photos:
        kind = "image"
        first_url = photos[0].get("url") or ""
        if first_url:
            previews["image"] = proxy_url_for(first_url)
        for idx, ph in enumerate(photos):
            p_url = ph.get("url")
            if not p_url:
                continue
            ext = Path(urllib.parse.urlparse(p_url).path).suffix.lstrip(".") or "jpg"
            if len(photos) == 1:
                options.extend(build_image_options(p_url, ext))
            else:
                options.append({"id": "direct_url", "targetUrl": p_url, "label": f"Photo {idx + 1} ({ext.upper()})", "ext": ext, "kind": "image"})

    if not options:
        return None

    return {
        "kind": kind,
        "platform": "X / Twitter",
        "title": title,
        "uploader": f"@{author}",
        "duration": format_duration(videos[0].get("duration")) if videos else "",
        "description": "",
        "thumbnailUrl": previews.get("image", ""),
        "previewUrl": previews.get(kind) or next(iter(previews.values()), ""),
        "previews": previews,
        "options": options,
    }


def extract_og_fallback(url: str, html_text: str) -> dict:
    def find_meta(prop: str) -> str:
        patterns = [
            rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)["\']',
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
        ]
        for pat in patterns:
            m = re.search(pat, html_text, re.IGNORECASE)
            if m:
                return html_lib.unescape(m.group(1).strip())
        return ""

    title_match = re.search(r"<title[^>]*>(.*?)</title>", html_text, re.IGNORECASE | re.DOTALL)
    title = find_meta("og:title") or (html_lib.unescape(re.sub(r"\s+", " ", title_match.group(1)).strip()) if title_match else "")
    og_video = (
        find_meta("og:video:secure_url")
        or find_meta("og:video:url")
        or find_meta("og:video")
        or find_meta("twitter:player:stream")
    )
    og_audio = find_meta("og:audio:secure_url") or find_meta("og:audio:url") or find_meta("og:audio")
    og_image = find_meta("og:image:secure_url") or find_meta("og:image") or find_meta("twitter:image")
    desc = find_meta("og:description") or find_meta("description")

    if not og_video:
        m_vid = re.search(r'<(?:video|source)[^>]+src=["\']([^"\']+\.(?:mp4|webm|mov)[^"\']*)["\']', html_text, re.IGNORECASE)
        if m_vid:
            og_video = html_lib.unescape(m_vid.group(1).strip())
    if not og_audio:
        m_aud = re.search(r'<(?:audio|source)[^>]+src=["\']([^"\']+\.(?:mp3|m4a|wav|ogg)[^"\']*)["\']', html_text, re.IGNORECASE)
        if m_aud:
            og_audio = html_lib.unescape(m_aud.group(1).strip())

    domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
    options = []
    previews = {}
    preview_kind = "webpage"

    if og_video:
        abs_vid = urllib.parse.urljoin(url, og_video)
        preview_kind = "video"
        previews["video"] = proxy_url_for(abs_vid)
        previews["audio"] = f"/api/convert-audio?url={urllib.parse.quote(abs_vid, safe='')}&fmt=mp3&inline=1"
        options.append({"id": "direct_url", "targetUrl": abs_vid, "label": "Video · MP4", "ext": "mp4", "kind": "video"})
        options.append({"id": "direct_audio_mp3", "targetUrl": abs_vid, "label": "Extract Audio · MP3", "ext": "mp3", "kind": "audio"})
    if og_audio:
        abs_aud = urllib.parse.urljoin(url, og_audio)
        ext = Path(urllib.parse.urlparse(abs_aud).path).suffix.lstrip(".") or "mp3"
        if preview_kind == "webpage":
            preview_kind = "audio"
        previews["audio"] = proxy_url_for(abs_aud)
        options.extend(build_audio_options(abs_aud, ext))
    if og_image:
        abs_img = urllib.parse.urljoin(url, og_image)
        previews["image"] = proxy_url_for(abs_img)
        if preview_kind == "webpage":
            preview_kind = "image"
        ext = Path(urllib.parse.urlparse(abs_img).path).suffix.lstrip(".") or "jpg"
        options.extend(build_image_options(abs_img, ext))

    options.append({"id": "direct_url", "targetUrl": url, "label": "Webpage HTML", "ext": "html", "kind": "file"})

    return {
        "kind": preview_kind,
        "platform": domain or "Web",
        "title": title or domain or "Web Link",
        "uploader": domain,
        "duration": "",
        "description": desc[:180] if desc else "",
        "thumbnailUrl": previews.get("image", ""),
        "previewUrl": previews.get(preview_kind) or next(iter(previews.values()), ""),
        "previews": previews,
        "options": options,
    }


def _fmt_sort_key(f: dict) -> tuple[int, float]:
    h = int(f.get("height") or 0)
    tbr = float(f.get("tbr") or 0)
    if not tbr:
        m = re.search(r"http-(\d+)", str(f.get("format_id") or ""))
        if m:
            tbr = float(m.group(1))
    return (h, tbr)


def inspect_via_ytdlp(url: str) -> dict | None:
    opts = {**base_ydl_opts(), "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        return None
    if "entries" in info and info["entries"]:
        info = next((e for e in info["entries"] if e), None)
        if not info:
            return None

    title = info.get("title") or "Media"
    uploader = info.get("uploader") or info.get("channel") or ""
    extractor = info.get("extractor_key") or info.get("extractor") or "Web"
    duration = format_duration(info.get("duration"))
    raw_thumb = info.get("thumbnail") or ""
    thumb_proxy = proxy_url_for(raw_thumb) if raw_thumb else ""

    formats = info.get("formats") or []

    # Include formats where vcodec & acodec are NOT explicitly 'none'
    # (Covers YouTube format 18 AND Twitter/Instagram progressive http-* MP4s where codecs are None!)
    progressive = [
        f for f in formats
        if f.get("url")
        and f.get("protocol") in ("http", "https", None)
        and f.get("vcodec") != "none"
        and f.get("acodec") != "none"
        and f.get("ext") in ("mp4", "webm")
        and "audio" not in str(f.get("format_id") or "").lower()
    ]
    progressive.sort(key=_fmt_sort_key, reverse=True)

    audio_only = [
        f for f in formats
        if f.get("url")
        and f.get("protocol") in ("http", "https", None)
        and f.get("vcodec") == "none"
        and f.get("acodec") != "none"
    ]
    audio_only.sort(key=lambda f: float(f.get("abr") or f.get("tbr") or 0), reverse=True)

    video_heights = sorted(
        {int(f["height"]) for f in formats if f.get("height") and f.get("vcodec") != "none"},
        reverse=True,
    )
    has_any_video = bool(progressive or video_heights or any(f.get("vcodec") != "none" for f in formats))
    has_webm = any(f.get("ext") == "webm" and f.get("vcodec") != "none" for f in formats)

    previews: dict[str, str] = {}
    if thumb_proxy:
        previews["image"] = thumb_proxy

    # Video preview: pick crisp 360p/480p progressive stream so playback starts instantly
    if progressive:
        preview_fmt = next(
            (f for f in reversed(progressive) if 240 <= (f.get("height") or 0) <= 480),
            progressive[-1],
        )
        previews["video"] = proxy_url_for(preview_fmt["url"])
    elif has_any_video:
        previews["video"] = f"/api/stream-video?url={urllib.parse.quote(url, safe='')}"

    # Audio preview: direct audio stream, or quick MP3 audio preview from smallest progressive video
    if audio_only:
        previews["audio"] = proxy_url_for(audio_only[0]["url"])
    elif progressive:
        previews["audio"] = f"/api/convert-audio?url={urllib.parse.quote(progressive[-1]['url'], safe='')}&fmt=mp3&inline=1"
    elif has_any_video:
        previews["audio"] = f"/api/stream-audio?url={urllib.parse.quote(url, safe='')}"

    # Determine primary kind
    if has_any_video:
        preview_kind = "video"
    elif audio_only:
        preview_kind = "audio"
    elif info.get("url") and classify_content_type("", info.get("url")) == "image":
        preview_kind = "image"
        previews["image"] = proxy_url_for(info["url"])
    else:
        preview_kind = "image" if thumb_proxy else "file"

    options = []
    added_heights = set()
    for p in progressive:
        h = int(p.get("height") or 0)
        ext = p.get("ext", "mp4")
        tbr = round(float(p.get("tbr") or 0))
        tag = f"{h}p" if h else (f"{tbr}kbps" if tbr else "Direct")
        if h and h in added_heights:
            continue
        if h:
            added_heights.add(h)
        options.append({
            "id": "direct_url",
            "targetUrl": p["url"],
            "label": f"Video ({tag}) · {ext.upper()}",
            "ext": ext,
            "kind": "video",
        })

    for h in video_heights:
        if h not in added_heights and h in (2160, 1440, 1080, 720, 480, 360, 240):
            added_heights.add(h)
            options.append({
                "id": f"video_h_{h}",
                "label": f"Video {h}p · MP4",
                "ext": "mp4",
                "kind": "video",
            })

    if not options and has_any_video:
        options.append({"id": "video_best", "label": "Best Video · MP4", "ext": "mp4", "kind": "video"})

    if has_webm:
        options.append({"id": "video_webm", "label": "Video · WEBM", "ext": "webm", "kind": "video"})

    if audio_only:
        best_a = audio_only[0]
        a_ext = best_a.get("ext") or "m4a"
        options.append({
            "id": "direct_url",
            "targetUrl": best_a["url"],
            "label": f"Audio · {a_ext.upper()} (Direct)",
            "ext": a_ext,
            "kind": "audio",
        })
    if audio_only or has_any_video:
        options.append({"id": "audio_mp3", "label": "Audio · MP3", "ext": "mp3", "kind": "audio"})
        options.append({"id": "audio_wav", "label": "Audio · WAV", "ext": "wav", "kind": "audio"})

    if raw_thumb:
        options.extend(build_image_options(raw_thumb, "jpg"))

    if not options and info.get("url"):
        ext = info.get("ext") or "bin"
        options.append({"id": "direct_url", "targetUrl": info["url"], "label": f"Download ({ext.upper()})", "ext": ext, "kind": "file"})

    return {
        "kind": preview_kind,
        "platform": extractor,
        "title": title,
        "uploader": uploader,
        "duration": duration,
        "description": (info.get("description") or "")[:180],
        "thumbnailUrl": thumb_proxy,
        "previewUrl": previews.get(preview_kind) or next(iter(previews.values()), ""),
        "previews": previews,
        "options": options,
    }


@app.route("/")
def serve_home():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "stateless": True,
        "yt_dlp": True,
        "ffmpeg": Path(FFMPEG_EXE).exists(),
        "rembg": importlib.util.find_spec("rembg") is not None,
        "pypdf": importlib.util.find_spec("pypdf") is not None,
    })


@app.route("/api/inspect", methods=["POST"])
def api_inspect():
    cleanup_old_downloads()
    body = request.get_json(silent=True) or {}
    try:
        url = validate_http_url(body.get("url", ""))
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    headers = {"User-Agent": USER_AGENT}
    direct_kind = "html"
    content_type = ""
    size_bytes = None
    final_url = url
    disp_name = ""
    html_snippet = ""

    try:
        resp = requests.get(url, headers=headers, stream=True, timeout=10, allow_redirects=True)
        final_url = resp.url or url
        content_type = resp.headers.get("Content-Type", "")
        cl = resp.headers.get("Content-Length")
        size_bytes = int(cl) if cl and cl.isdigit() else None
        cd = resp.headers.get("Content-Disposition", "")
        m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', cd, re.IGNORECASE)
        if m:
            disp_name = urllib.parse.unquote(m.group(1)).strip()

        direct_kind = classify_content_type(content_type, final_url)
        if direct_kind == "html":
            chunk = b""
            for part in resp.iter_content(chunk_size=65536):
                chunk += part
                if len(chunk) >= 262144:
                    break
            html_snippet = chunk.decode("utf-8", errors="ignore")
        resp.close()
    except requests.RequestException:
        pass

    if direct_kind != "html":
        parsed = urllib.parse.urlparse(final_url)
        raw_name = disp_name or Path(parsed.path).name or "file"
        ext = (
            Path(raw_name).suffix.lstrip(".").lower()
            or (mimetypes.guess_extension(content_type.split(";")[0].strip()) or "").lstrip(".").lower()
            or "bin"
        )
        domain = parsed.netloc.replace("www.", "")
        proxy_url = proxy_url_for(final_url)
        previews = {}

        if direct_kind == "image":
            previews["image"] = proxy_url
            options = build_image_options(final_url, ext)
        elif direct_kind == "audio":
            previews["audio"] = proxy_url
            options = build_audio_options(final_url, ext)
        elif direct_kind == "video":
            previews["video"] = proxy_url
            previews["audio"] = f"/api/convert-audio?url={urllib.parse.quote(final_url, safe='')}&fmt=mp3&inline=1"
            options = [
                {"id": "direct_url", "targetUrl": final_url, "label": f"Original Video ({ext.upper()})", "ext": ext, "kind": "video"},
                {"id": "direct_audio_mp3", "targetUrl": final_url, "label": "Extract Audio · MP3", "ext": "mp3", "kind": "audio"},
                {"id": "direct_audio_wav", "targetUrl": final_url, "label": "Extract Audio · WAV", "ext": "wav", "kind": "audio"},
            ]
        else:
            if direct_kind == "pdf":
                previews["pdf"] = proxy_url
            options = [
                {"id": "direct_url", "targetUrl": final_url, "label": f"Original File ({ext.upper()})", "ext": ext, "kind": direct_kind},
            ]

        return jsonify({
            "sourceUrl": final_url,
            "kind": direct_kind,
            "platform": domain or "Direct Link",
            "title": raw_name,
            "uploader": domain,
            "duration": "",
            "sizeBytes": size_bytes,
            "contentType": content_type.split(";")[0].strip(),
            "thumbnailUrl": proxy_url if direct_kind == "image" else "",
            "previewUrl": proxy_url,
            "previews": previews,
            "options": options,
        })

    # Try yt-dlp first
    yt_error_msg = ""
    try:
        yt_info = inspect_via_ytdlp(url)
        if yt_info:
            yt_info["sourceUrl"] = url
            return jsonify(yt_info)
    except Exception as yt_err:
        yt_error_msg = str(yt_err)

    # For X / Twitter links (videos, photos, or when yt-dlp guest token is blocked), use fxtwitter fallback
    fx_info = extract_twitter_fx_fallback(url)
    if fx_info:
        fx_info["sourceUrl"] = url
        return jsonify(fx_info)

    if html_snippet:
        og = extract_og_fallback(final_url, html_snippet)
        og["sourceUrl"] = final_url
        return jsonify(og)

    return jsonify({"error": yt_error_msg or "Could not fetch details from this link."}), 422


@app.route("/api/preview")
def api_preview():
    try:
        url = validate_http_url(request.args.get("url", ""))
    except ValueError as err:
        return str(err), 400

    req_headers = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
    if "Range" in request.headers:
        req_headers["Range"] = request.headers["Range"]

    try:
        upstream = HTTP_SESSION.get(url, headers=req_headers, stream=True, timeout=20, allow_redirects=True)
    except requests.RequestException as err:
        return f"Preview failed: {err}", 502

    excluded = {"content-encoding", "transfer-encoding", "connection", "content-security-policy"}
    resp_headers = {
        k.encode("ascii", "ignore").decode("ascii"): v.encode("ascii", "ignore").decode("ascii")
        for k, v in upstream.headers.items()
        if k.lower() not in excluded
    }
    if "Content-Type" not in resp_headers:
        resp_headers["Content-Type"] = "application/octet-stream"

    return Response(
        stream_with_context(upstream.iter_content(chunk_size=131072)),
        status=upstream.status_code,
        headers=resp_headers,
    )


@app.route("/api/stream-video")
def api_stream_video():
    """Ephemeral MP4 preview when a platform only provides HLS/DASH split streams."""
    try:
        url = validate_http_url(request.args.get("url", ""))
    except ValueError as err:
        return str(err), 400

    token = uuid.uuid4().hex
    out_tmpl = str(DOWNLOAD_DIR / f"prev_{token}.%(ext)s")
    ydl_opts = {
        **base_ydl_opts(),
        "outtmpl": out_tmpl,
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best",
        "merge_output_format": "mp4",
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)
        matches = sorted(DOWNLOAD_DIR.glob(f"prev_{token}.*"))
        if not matches:
            return "Preview stream unavailable", 404
        out_path = matches[0]
    except Exception as err:
        return f"Preview failed: {err}", 500

    def stream_and_delete():
        try:
            with open(out_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            out_path.unlink(missing_ok=True)

    return Response(
        stream_with_context(stream_and_delete()),
        headers={
            "Content-Type": "video/mp4",
            "Content-Length": str(out_path.stat().st_size),
            "Accept-Ranges": "none",
        },
    )


@app.route("/api/stream-audio")
def api_stream_audio():
    """Ephemeral MP3 audio preview when no direct audio stream exists."""
    try:
        url = validate_http_url(request.args.get("url", ""))
    except ValueError as err:
        return str(err), 400

    token = uuid.uuid4().hex
    out_tmpl = str(DOWNLOAD_DIR / f"aud_{token}.%(ext)s")
    ydl_opts = {
        **base_ydl_opts(),
        "outtmpl": out_tmpl,
        "format": "bestaudio/best",
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"}],
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)
        matches = sorted(DOWNLOAD_DIR.glob(f"aud_{token}.*"))
        if not matches:
            return "Audio preview unavailable", 404
        out_path = matches[0]
    except Exception as err:
        return f"Audio preview failed: {err}", 500

    def stream_and_delete():
        try:
            with open(out_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            out_path.unlink(missing_ok=True)

    return Response(
        stream_with_context(stream_and_delete()),
        headers={
            "Content-Type": "audio/mpeg",
            "Content-Length": str(out_path.stat().st_size),
        },
    )


@app.route("/api/download", methods=["POST"])
def api_download():
    cleanup_old_downloads()
    body = request.get_json(silent=True) or {}
    try:
        url = validate_http_url(body.get("url", ""))
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    option_id = body.get("optionId", "video_best")
    target_url = body.get("targetUrl") or url
    title = sanitize_filename(body.get("title") or "download")
    ext = re.sub(r"[^a-zA-Z0-9]", "", body.get("ext") or "bin").lower() or "bin"

    if option_id == "direct_url":
        try:
            target = validate_http_url(target_url)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        download_name = title if title.lower().endswith(f".{ext}") else f"{title}.{ext}"
        proxy_dl = (
            f"/api/proxy-file?url={urllib.parse.quote(target, safe='')}"
            f"&name={urllib.parse.quote(download_name, safe='')}"
        )
        return jsonify({"downloadUrl": proxy_dl, "filename": download_name})

    if option_id in {"img_png", "img_jpg", "img_webp"}:
        fmt = option_id.split("_", 1)[1]
        try:
            target = validate_http_url(target_url)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        base_stem = Path(title).stem or title
        download_name = f"{base_stem}.{fmt}"
        convert_url = (
            f"/api/convert-image?url={urllib.parse.quote(target, safe='')}"
            f"&fmt={fmt}&name={urllib.parse.quote(download_name, safe='')}"
        )
        return jsonify({"downloadUrl": convert_url, "filename": download_name})

    if option_id in {"direct_audio_mp3", "direct_audio_m4a", "direct_audio_wav"}:
        fmt = option_id.split("_")[-1]
        try:
            target = validate_http_url(target_url)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        base_stem = Path(title).stem or title
        download_name = f"{base_stem}.{fmt}"
        audio_url = (
            f"/api/convert-audio?url={urllib.parse.quote(target, safe='')}"
            f"&fmt={fmt}&name={urllib.parse.quote(download_name, safe='')}"
        )
        return jsonify({"downloadUrl": audio_url, "filename": download_name})

    token = uuid.uuid4().hex
    out_tmpl = str(DOWNLOAD_DIR / f"{token}.%(ext)s")

    if option_id == "audio_mp3":
        ydl_opts = {
            **base_ydl_opts(),
            "outtmpl": out_tmpl,
            "format": "bestaudio/best",
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
            ],
        }
        final_ext = "mp3"
    elif option_id == "audio_wav":
        ydl_opts = {
            **base_ydl_opts(),
            "outtmpl": out_tmpl,
            "format": "bestaudio/best",
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "wav"}
            ],
        }
        final_ext = "wav"
    elif option_id == "video_webm":
        ydl_opts = {
            **base_ydl_opts(),
            "outtmpl": out_tmpl,
            "format": "bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio/best",
            "merge_output_format": "webm",
        }
        final_ext = "webm"
    elif option_id.startswith("video_h_"):
        h = int(option_id.split("_")[-1])
        ydl_opts = {
            **base_ydl_opts(),
            "outtmpl": out_tmpl,
            "format": f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/best[height<={h}][ext=mp4]/bestvideo[height<={h}]+bestaudio/best[height<={h}]/best",
            "merge_output_format": "mp4",
        }
        final_ext = "mp4"
    else:
        ydl_opts = {
            **base_ydl_opts(),
            "outtmpl": out_tmpl,
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bestvideo+bestaudio/best",
            "merge_output_format": "mp4",
        }
        final_ext = "mp4"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            real_title = sanitize_filename(info.get("title") or title) if info else title

        matches = sorted(DOWNLOAD_DIR.glob(f"{token}.*"))
        if not matches:
            return jsonify({"error": "Download finished but output file was not found."}), 500
        out_path = matches[0]
        actual_ext = out_path.suffix.lstrip(".") or final_ext
        download_name = f"{real_title}.{actual_ext}"
        READY_FILES[token] = (out_path, download_name)
        return jsonify({
            "downloadUrl": f"/api/file/{token}",
            "filename": download_name,
            "sizeBytes": out_path.stat().st_size,
        })
    except Exception as err:
        return jsonify({"error": f"Download failed: {err}"}), 500


@app.route("/api/convert-image")
def api_convert_image():
    try:
        url = validate_http_url(request.args.get("url", ""))
    except ValueError as err:
        return str(err), 400
    fmt = (request.args.get("fmt") or "png").lower()
    if fmt not in {"png", "jpg", "webp"}:
        return "Unsupported image format", 400
    name = sanitize_filename(request.args.get("name", f"image.{fmt}"))

    try:
        upstream = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20, allow_redirects=True)
        upstream.raise_for_status()
        img = Image.open(io.BytesIO(upstream.content))
        if fmt == "jpg":
            if img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
        buf = io.BytesIO()
        pil_fmt = "JPEG" if fmt == "jpg" else fmt.upper()
        img.save(buf, format=pil_fmt, quality=92)
        buf.seek(0)
    except Exception as err:
        return f"Image conversion failed: {err}", 500

    return Response(
        buf.getvalue(),
        headers={
            "Content-Type": f"image/{'jpeg' if fmt == 'jpg' else fmt}",
            "Content-Disposition": f'attachment; filename="{name}"',
        },
    )


@app.route("/api/convert-audio")
def api_convert_audio():
    try:
        url = validate_http_url(request.args.get("url", ""))
    except ValueError as err:
        return str(err), 400
    fmt = (request.args.get("fmt") or "mp3").lower()
    if fmt not in {"mp3", "m4a", "wav"}:
        return "Unsupported audio format", 400
    inline = request.args.get("inline") == "1"
    name = sanitize_filename(request.args.get("name", f"audio.{fmt}"))

    # Stream inline MP3 previews directly via ffmpeg pipe (zero disk file!)
    if inline and fmt == "mp3":
        pipe_cmd = [FFMPEG_EXE, "-y", "-i", url, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"]
        proc = subprocess.Popen(pipe_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

        def stream_pipe():
            try:
                while True:
                    chunk = proc.stdout.read(65536)
                    if not chunk:
                        break
                    yield chunk
            finally:
                if proc.poll() is None:
                    proc.terminate()

        return Response(stream_with_context(stream_pipe()), headers={"Content-Type": "audio/mpeg"})

    token = uuid.uuid4().hex
    out_path = DOWNLOAD_DIR / f"{token}.{fmt}"
    cmd = [FFMPEG_EXE, "-y", "-i", url, "-vn"]
    if fmt == "mp3":
        cmd += ["-c:a", "libmp3lame", "-b:a", "192k"]
    elif fmt == "m4a":
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-c:a", "pcm_s16le"]
    cmd.append(str(out_path))

    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if proc.returncode != 0 or not out_path.exists():
            return "Audio conversion failed", 500
    except Exception as err:
        out_path.unlink(missing_ok=True)
        return f"Audio conversion failed: {err}", 500

    def stream_and_delete():
        try:
            with open(out_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            out_path.unlink(missing_ok=True)

    headers = {
        "Content-Type": f"audio/{'mpeg' if fmt == 'mp3' else fmt}",
        "Content-Length": str(out_path.stat().st_size),
    }
    if not inline:
        headers["Content-Disposition"] = f'attachment; filename="{name}"'

    return Response(stream_with_context(stream_and_delete()), headers=headers)


@app.route("/api/file/<token>")
def api_get_file(token: str):
    item = READY_FILES.pop(token, None)
    if not item:
        return "File expired or not found", 404
    file_path, download_name = item
    if not file_path.exists():
        return "File not found", 404

    def stream_and_delete():
        try:
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                pass

    return Response(
        stream_with_context(stream_and_delete()),
        headers={
            "Content-Type": "application/octet-stream",
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "Content-Length": str(file_path.stat().st_size),
        },
    )


@app.route("/api/proxy-file")
def api_proxy_file():
    try:
        url = validate_http_url(request.args.get("url", ""))
    except ValueError as err:
        return str(err), 400
    name = sanitize_filename(request.args.get("name", "download"))
    try:
        upstream = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}, stream=True, timeout=30, allow_redirects=True)
    except requests.RequestException as err:
        return f"Download failed: {err}", 502

    ct = upstream.headers.get("Content-Type", "application/octet-stream")
    # Sanitize to ASCII — Waitress encodes headers as latin-1 and crashes on Unicode
    ct = ct.encode("ascii", "ignore").decode("ascii") or "application/octet-stream"
    cl = upstream.headers.get("Content-Length", "")
    cl = cl.encode("ascii", "ignore").decode("ascii") if cl else ""
    headers = {
        "Content-Type": ct,
        "Content-Disposition": f'attachment; filename="{name}"',
    }
    if cl:
        headers["Content-Length"] = cl

    return Response(
        stream_with_context(upstream.iter_content(chunk_size=65536)),
        status=upstream.status_code,
        headers=headers,
    )


REMBG_LOCK = threading.Lock()
REMBG_SESSIONS: dict[str, object] = {}
BG_MODE_MODELS = {
    "high": ("isnet-general-use", "u2net"),
    "portrait": ("u2net_human_seg", "isnet-general-use"),
    "fast": ("silueta", "u2netp"),
}

try:
    import rembg as _REMBG_MOD
except ImportError:
    _REMBG_MOD = None


def _get_rembg_session(mode: str):
    """Load and cache the ONNX segmentation session for the requested mode."""
    rembg_mod = _REMBG_MOD
    if rembg_mod is None:
        import rembg as rembg_mod

    candidates = BG_MODE_MODELS.get(mode, BG_MODE_MODELS["high"])
    with REMBG_LOCK:
        for model_name in candidates:
            if model_name in REMBG_SESSIONS:
                return rembg_mod, model_name, REMBG_SESSIONS[model_name]
        last_err = None
        for model_name in candidates:
            try:
                sess = rembg_mod.new_session(model_name)
                REMBG_SESSIONS[model_name] = sess
                return rembg_mod, model_name, sess
            except Exception as exc:
                last_err = exc
        raise RuntimeError(f"Could not initialize background model: {last_err}")


def _parse_hex_rgba(value: str) -> tuple[int, int, int, int] | None:
    raw = (value or "").strip().lower()
    if not raw or raw == "transparent":
        return None
    if re.fullmatch(r"#[0-9a-f]{6}", raw):
        return (int(raw[1:3], 16), int(raw[3:5], 16), int(raw[5:7], 16), 255)
    if re.fullmatch(r"#[0-9a-f]{3}", raw):
        return (int(raw[1] * 2, 16), int(raw[2] * 2, 16), int(raw[3] * 2, 16), 255)
    raise ValueError("Invalid background fill color.")


@app.route("/api/remove-bg", methods=["POST"])
def api_remove_bg():
    upload = request.files.get("image")
    if not upload:
        return jsonify({"error": "No image file provided."}), 400

    raw_bytes = upload.read()
    if not raw_bytes:
        return jsonify({"error": "Uploaded image is empty."}), 400
    if len(raw_bytes) > 25 * 1024 * 1024:
        return jsonify({"error": "Image exceeds 25 MB limit."}), 400

    mode = (request.form.get("mode") or "high").strip().lower()
    refine = (request.form.get("refine") or "1").strip().lower() in ("1", "true", "yes", "on")

    try:
        bgcolor = _parse_hex_rgba(request.form.get("bg_color", "transparent"))
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    try:
        src_img = Image.open(io.BytesIO(raw_bytes))
        src_img = ImageOps.exif_transpose(src_img)
        if src_img.mode not in ("RGB", "RGBA"):
            src_img = src_img.convert("RGBA")
        orig_w, orig_h = src_img.size
    except Exception:
        return jsonify({"error": "Could not decode uploaded image."}), 400

    try:
        rembg, model_used, session = _get_rembg_session(mode)
        use_decontam = refine and mode != "fast" and max(orig_w, orig_h) <= 3200
        try:
            cutout = rembg.remove(
                src_img,
                session=session,
                decontaminate=use_decontam,
            )
        except Exception:
            cutout = rembg.remove(src_img, session=session)

        if cutout.size != (orig_w, orig_h):
            cutout = cutout.resize((orig_w, orig_h), Image.Resampling.LANCZOS)
        if cutout.mode != "RGBA":
            cutout = cutout.convert("RGBA")
        if bgcolor is not None:
            backdrop = Image.new("RGBA", cutout.size, bgcolor)
            cutout = Image.alpha_composite(backdrop, cutout)
    except Exception as exc:
        return jsonify({"error": f"Background removal failed: {exc}"}), 500

    out_buf = io.BytesIO()
    cutout.save(out_buf, format="PNG", compress_level=6)
    stem = sanitize_filename(Path(upload.filename or "cutout").stem or "cutout")
    out_name = f"{stem}-nobg.png"

    return Response(
        out_buf.getvalue(),
        mimetype="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="{out_name}"',
            "X-Image-Width": str(orig_w),
            "X-Image-Height": str(orig_h),
            "X-Model-Used": model_used,
            "Cache-Control": "no-store",
        },
    )


def _compress_image_bytes(
    raw_bytes: bytes, ext: str, level: str, target_fmt: str
) -> tuple[bytes, str, str, str]:
    """Compress an image while preserving dimensions and visual quality."""
    src = Image.open(io.BytesIO(raw_bytes))
    icc = src.info.get("icc_profile")
    ext_low = ext.lower()

    if target_fmt == "webp":
        im = ImageOps.exif_transpose(src)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        buf = io.BytesIO()
        kw: dict = {"format": "WEBP", "method": 6}
        if icc:
            kw["icc_profile"] = icc
        if level == "lossless":
            kw["lossless"] = True
            note = "Lossless WebP encoding (exact pixel fidelity)"
        elif level == "compact":
            kw["quality"] = 78
            note = "Compact high-detail WebP (Q78)"
        else:
            kw["quality"] = 88
            note = "Visually lossless WebP (Q88)"
        im.save(buf, **kw)
        out = buf.getvalue()
        if ext_low == ".webp" and len(out) >= len(raw_bytes):
            return raw_bytes, ".webp", "image/webp", "Already optimal - kept original WebP"
        return out, ".webp", "image/webp", note

    # Keep original format (converting uncompressed .bmp/.dib to lossless .png)
    if ext_low in (".gif",) and getattr(src, "is_animated", False):
        frames = []
        durations = []
        for idx in range(getattr(src, "n_frames", 1)):
            src.seek(idx)
            frames.append(src.copy())
            durations.append(src.info.get("duration", 80))
        buf = io.BytesIO()
        frames[0].save(
            buf,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            loop=src.info.get("loop", 0),
            duration=durations,
            optimize=True,
        )
        out = buf.getvalue()
        if len(out) >= len(raw_bytes):
            return raw_bytes, ".gif", "image/gif", "Already optimal - kept original GIF"
        return out, ".gif", "image/gif", "Lossless animated GIF frame optimization"

    im = ImageOps.exif_transpose(src)
    buf = io.BytesIO()

    if ext_low in (".jpg", ".jpeg"):
        if im.mode != "RGB":
            im = im.convert("RGB")
        q_map = {"lossless": 94, "balanced": 85, "compact": 76}
        q = q_map.get(level, 85)
        kw = {"format": "JPEG", "quality": q, "optimize": True, "progressive": True}
        if level != "compact":
            kw["subsampling"] = 0
        if icc:
            kw["icc_profile"] = icc
        im.save(buf, **kw)
        out = buf.getvalue()
        if len(out) >= len(raw_bytes):
            return raw_bytes, ".jpg", "image/jpeg", "Already optimal - kept original JPEG"
        return out, ".jpg", "image/jpeg", f"High-detail JPEG optimization (Q{q})"

    if ext_low in (".webp",):
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        kw = {"format": "WEBP", "method": 6}
        if icc:
            kw["icc_profile"] = icc
        if level == "lossless":
            kw["lossless"] = True
        else:
            kw["quality"] = 88 if level == "balanced" else 78
        im.save(buf, **kw)
        out = buf.getvalue()
        if len(out) >= len(raw_bytes):
            return raw_bytes, ".webp", "image/webp", "Already optimal - kept original WebP"
        return out, ".webp", "image/webp", "High-efficiency WebP compression"

    # PNG / BMP / TIFF -> lossless optimize=True PNG (or compact quantized PNG when requested)
    if im.mode not in ("RGB", "RGBA", "L", "LA", "P"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    out_ext = ".png"
    out_mime = "image/png"
    kw = {"format": "PNG", "optimize": True, "compress_level": 9}
    if icc:
        kw["icc_profile"] = icc

    if level == "compact" and ext_low == ".png":
        q_im = im.convert("RGBA").quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        q_im.save(buf, **kw)
        out = buf.getvalue()
        note = "High-density 256-color quantized PNG"
    else:
        im.save(buf, **kw)
        out = buf.getvalue()
        note = (
            "Lossless BMP to PNG conversion (exact pixel fidelity)"
            if ext_low in (".bmp", ".dib", ".tif", ".tiff")
            else "Lossless PNG deflate compression"
        )

    if ext_low == ".png" and len(out) >= len(raw_bytes):
        return raw_bytes, ".png", "image/png", "Already optimal - kept original PNG"
    return out, out_ext, out_mime, note


def _compress_pdf_bytes(raw_bytes: bytes, level: str) -> tuple[bytes, str, str, str]:
    """Compress PDF streams, deduplicate objects, and optionally optimize embedded images."""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(raw_bytes))
    writer = PdfWriter(clone_from=reader)

    optimized_imgs = 0
    if level in ("balanced", "compact"):
        q = 86 if level == "balanced" else 74
        for page in writer.pages:
            try:
                page_images = list(page.images)
            except Exception:
                page_images = []
            for img_file in page_images:
                try:
                    if not img_file.data or len(img_file.data) < 8192:
                        continue
                    pil_img = img_file.image
                    if pil_img is None or pil_img.mode not in ("RGB", "L"):
                        continue
                    test_buf = io.BytesIO()
                    pil_img.save(test_buf, "PDF", quality=q)
                    if test_buf.tell() < len(img_file.data) * 0.90:
                        img_file.replace(pil_img, quality=q)
                        optimized_imgs += 1
                except Exception:
                    continue

    for page in writer.pages:
        try:
            page.compress_content_streams(level=9)
        except Exception:
            continue

    try:
        writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
    except Exception:
        pass

    out_buf = io.BytesIO()
    writer.write(out_buf)
    out = out_buf.getvalue()
    if len(out) >= len(raw_bytes):
        return raw_bytes, ".pdf", "application/pdf", "Already optimal - kept original PDF"
    note = (
        f"Lossless PDF stream & object compression ({optimized_imgs} image(s) optimized)"
        if optimized_imgs
        else "Lossless PDF stream & object compression (vectors untouched)"
    )
    return out, ".pdf", "application/pdf", note


def _compress_media_file(
    in_path: Path, ext: str, kind: str, level: str, tmp: Path
) -> tuple[Path, str, str, str]:
    """Compress video or audio from disk via ffmpeg without size limits."""
    ext_low = ext.lower() or (".mp4" if kind == "video" else ".mp3")
    orig_size = in_path.stat().st_size

    if kind == "video":
        use_webm = ext_low == ".webm"
        out_ext = ".webm" if use_webm else ".mp4"
        out_mime = "video/webm" if use_webm else "video/mp4"
        out_path = tmp / f"output{out_ext}"
        if use_webm:
            crf = {"lossless": "26", "balanced": "32", "compact": "36"}.get(level, "32")
            cmd = [
                FFMPEG_EXE, "-y", "-i", str(in_path),
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libvpx-vp9", "-crf", crf, "-b:v", "0", "-row-mt", "1",
                "-c:a", "libopus", "-b:a", "128k",
                str(out_path),
            ]
            note = f"High-efficiency WebM VP9 (CRF {crf})"
        else:
            crf = {"lossless": "18", "balanced": "22", "compact": "26"}.get(level, "22")
            preset = "slow" if level == "lossless" else "medium"
            ab = {"lossless": "192k", "balanced": "160k", "compact": "128k"}.get(level, "160k")
            cmd = [
                FFMPEG_EXE, "-y", "-i", str(in_path),
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libx264", "-crf", crf, "-preset", preset,
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-c:a", "aac", "-b:a", ab,
                str(out_path),
            ]
            note = f"Visually lossless H.264 MP4 (CRF {crf})"
    else:
        if ext_low in (".wav", ".aiff", ".aif"):
            if level == "lossless":
                out_ext, out_mime = ".flac", "audio/flac"
                out_path = tmp / "output.flac"
                cmd = [FFMPEG_EXE, "-y", "-i", str(in_path), "-c:a", "flac", "-compression_level", "8", str(out_path)]
                note = "Lossless FLAC audio compression"
            else:
                out_ext, out_mime = ".mp3", "audio/mpeg"
                ab = "256k" if level == "balanced" else "160k"
                out_path = tmp / "output.mp3"
                cmd = [FFMPEG_EXE, "-y", "-i", str(in_path), "-vn", "-c:a", "libmp3lame", "-b:a", ab, str(out_path)]
                note = f"High-fidelity MP3 audio ({ab})"
        elif ext_low == ".m4a":
            out_ext, out_mime = ".m4a", "audio/mp4"
            ab = {"lossless": "256k", "balanced": "192k", "compact": "128k"}.get(level, "192k")
            out_path = tmp / "output.m4a"
            cmd = [FFMPEG_EXE, "-y", "-i", str(in_path), "-vn", "-c:a", "aac", "-b:a", ab, str(out_path)]
            note = f"AAC audio optimization ({ab})"
        elif ext_low == ".flac":
            out_ext, out_mime = ".flac", "audio/flac"
            out_path = tmp / "output.flac"
            cmd = [FFMPEG_EXE, "-y", "-i", str(in_path), "-c:a", "flac", "-compression_level", "12", str(out_path)]
            note = "Max-density lossless FLAC compression"
        elif ext_low == ".ogg":
            out_ext, out_mime = ".ogg", "audio/ogg"
            q = {"lossless": "8", "balanced": "6", "compact": "4"}.get(level, "6")
            out_path = tmp / "output.ogg"
            cmd = [FFMPEG_EXE, "-y", "-i", str(in_path), "-vn", "-c:a", "libvorbis", "-q:a", q, str(out_path)]
            note = f"Ogg Vorbis audio optimization (Q{q})"
        else:
            out_ext, out_mime = ".mp3", "audio/mpeg"
            ab = {"lossless": "320k", "balanced": "192k", "compact": "128k"}.get(level, "192k")
            out_path = tmp / "output.mp3"
            cmd = [FFMPEG_EXE, "-y", "-i", str(in_path), "-vn", "-c:a", "libmp3lame", "-b:a", ab, str(out_path)]
            note = f"MP3 audio optimization ({ab})"

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3600)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError(proc.stderr.decode("utf-8", errors="ignore")[-240:] or "ffmpeg encoding failed")
    if out_ext == ext_low and out_path.stat().st_size >= orig_size:
        return in_path, out_ext, out_mime, f"Already optimal - kept original {out_ext.upper().lstrip('.')}"
    return out_path, out_ext, out_mime, note


def _compress_generic_file(
    in_path: Path, orig_name: str, ext: str, tmp: Path
) -> tuple[Path, str, str, str]:
    """Losslessly compress SVG markup or stream-archive any file via ZIP Deflate."""
    ext_low = ext.lower()
    if ext_low == ".svg" and in_path.stat().st_size <= 25 * 1024 * 1024:
        try:
            raw_bytes = in_path.read_bytes()
            text = raw_bytes.decode("utf-8")
            minified = re.sub(r"<!--.*?-->", "", text, flags=re.S)
            minified = re.sub(r">\s+<", "><", minified).strip()
            min_bytes = minified.encode("utf-8")
            if len(min_bytes) < len(raw_bytes):
                out_svg = tmp / "output.svg"
                out_svg.write_bytes(min_bytes)
                return out_svg, ".svg", "image/svg+xml", "Lossless SVG markup optimization"
        except Exception:
            pass

    out_zip = tmp / "output.zip"
    inner_name = sanitize_filename(orig_name or "file", fallback="file")
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as zf:
        zf.write(in_path, arcname=inner_name)
    return out_zip, ".zip", "application/zip", "Lossless ZIP archive (bit-exact original preserved)"


def _stream_file_and_cleanup(file_path: Path, tmpdir: Path):
    try:
        with open(file_path, "rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                yield chunk
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.route("/api/compress", methods=["POST"])
def api_compress():
    upload = request.files.get("file")
    if not upload:
        return jsonify({"error": "No file provided."}), 400

    level = (request.form.get("level") or "balanced").strip().lower()
    if level not in ("lossless", "balanced", "compact"):
        level = "balanced"
    target_fmt = (request.form.get("image_format") or "auto").strip().lower()
    if target_fmt not in ("auto", "webp"):
        target_fmt = "auto"

    orig_name = upload.filename or "file"
    ext = Path(orig_name).suffix.lower()
    ct = (upload.content_type or "").split(";")[0].strip().lower()

    if ct.startswith("image/") and ext != ".svg" or ext in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".dib", ".tif", ".tiff", ".gif"}:
        kind = "image"
    elif ct == "application/pdf" or ext == ".pdf":
        kind = "pdf"
    elif ct.startswith("video/") or ext in {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}:
        kind = "video"
    elif ct.startswith("audio/") or ext in {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".aiff"}:
        kind = "audio"
    else:
        kind = "file"

    tmpdir = Path(tempfile.mkdtemp(prefix="cleanlab_comp_"))
    in_path = tmpdir / f"upload{ext}"
    try:
        upload.save(str(in_path))
        orig_size = in_path.stat().st_size
        if orig_size == 0:
            shutil.rmtree(tmpdir, ignore_errors=True)
            return jsonify({"error": "Uploaded file is empty."}), 400

        stem = sanitize_filename(Path(orig_name).stem or "compressed", fallback="compressed")

        if kind in ("video", "audio", "file"):
            if kind in ("video", "audio"):
                out_path, out_ext, out_mime, note = _compress_media_file(in_path, ext, kind, level, tmpdir)
            else:
                out_path, out_ext, out_mime, note = _compress_generic_file(in_path, orig_name, ext, tmpdir)
            comp_size = out_path.stat().st_size
            out_name = f"{stem}-compressed{out_ext}"
            return Response(
                stream_with_context(_stream_file_and_cleanup(out_path, tmpdir)),
                mimetype=out_mime,
                headers={
                    "Content-Length": str(comp_size),
                    "Content-Disposition": f'attachment; filename="{out_name}"',
                    "X-Original-Size": str(orig_size),
                    "X-Compressed-Size": str(comp_size),
                    "X-Compress-Kind": kind,
                    "X-Compress-Note": (note or "").encode("ascii", "ignore").decode("ascii"),
                    "X-Output-Ext": out_ext,
                    "Cache-Control": "no-store",
                },
            )

        raw_bytes = in_path.read_bytes()
        shutil.rmtree(tmpdir, ignore_errors=True)
        if kind == "image":
            out_bytes, out_ext, out_mime, note = _compress_image_bytes(raw_bytes, ext, level, target_fmt)
        else:
            out_bytes, out_ext, out_mime, note = _compress_pdf_bytes(raw_bytes, level)
        out_name = f"{stem}-compressed{out_ext}"
        return Response(
            out_bytes,
            mimetype=out_mime,
            headers={
                "Content-Length": str(len(out_bytes)),
                "Content-Disposition": f'attachment; filename="{out_name}"',
                "X-Original-Size": str(orig_size),
                "X-Compressed-Size": str(len(out_bytes)),
                "X-Compress-Kind": kind,
                "X-Compress-Note": (note or "").encode("ascii", "ignore").decode("ascii"),
                "X-Output-Ext": out_ext,
                "Cache-Control": "no-store",
            },
        )
    except Exception as exc:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return jsonify({"error": f"Compression failed: {exc}"}), 500


if __name__ == "__main__":
    if _REMBG_MOD is not None:
        try:
            _get_rembg_session("high")
        except Exception:
            pass
    port = int(os.environ.get("PORT", "8000"))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    print(f"Serving CleanLab on http://{host}:{port} (Waitress WSGI)", flush=True)
    from waitress import serve
    serve(app, host=host, port=port, threads=8)
