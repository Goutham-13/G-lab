from PyPDF2 import PdfReader, PdfWriter
import os

def split_pdf(file_path: str, splits: list, output_dir="output"):
    os.makedirs(output_dir, exist_ok=True)
    output_files = []

    reader = PdfReader(file_path)
    for i, (start, end) in enumerate(splits):
        writer = PdfWriter()
        for page_num in range(start-1, end):
            writer.add_page(reader.pages[page_num])
        output_file = os.path.join(output_dir, f"split_{i+1}.pdf")
        with open(output_file, "wb") as f:
            writer.write(f)
        output_files.append(output_file)

    return output_files
