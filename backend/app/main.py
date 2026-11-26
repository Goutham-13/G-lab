from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from qr_generator import generate_qr
from pdf_splitter import split_pdf
import json
import os

app = FastAPI()

# Allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# QR Code endpoint
@app.post("/generate-qr/")
async def qr_endpoint(text: str = Form(...)):
    file_path = generate_qr(text)
    return FileResponse(file_path, media_type="image/png", filename="qr.png")

# PDF Splitter endpoint
@app.post("/split-pdf/")
async def pdf_split(file: UploadFile, splits: str = Form(...)):
    contents = await file.read()
    file_path = f"temp_{file.filename}"
    with open(file_path, "wb") as f:
        f.write(contents)
    
    splits_list = json.loads(splits)  # e.g., [[1,2],[3,5]]
    output_files = split_pdf(file_path, splits_list)
    
    # Return first split file as example
    return FileResponse(output_files[0], filename="split.pdf")
