import qrcode
from fastapi.responses import FileResponse
import os

def generate_qr(text: str, file_path: str = "qr.png"):
    qr = qrcode.QRCode(
        version=1,
        box_size=10,
        border=5
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill="black", back_color="white")
    img.save(file_path)
    return file_path
