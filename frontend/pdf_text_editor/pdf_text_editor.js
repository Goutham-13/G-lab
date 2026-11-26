// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const pdfFileInput = document.getElementById("pdfFile");
const reOcrBtn = document.getElementById("reOcrBtn");
const addTextBoxBtn = document.getElementById("addTextBoxBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const pageContainer = document.getElementById("pageContainer");
const pdfCanvas = document.getElementById("pdfCanvas");
const statusEl = document.getElementById("status");

// Toolbar elements
const fontFamilySelect = document.getElementById("fontFamily");
const fontSizeSelect = document.getElementById("fontSize");
const fontColorInput = document.getElementById("fontColor");
const btnBold = document.getElementById("btnBold");
const btnItalic = document.getElementById("btnItalic");
const btnUnderline = document.getElementById("btnUnderline");

const canvasCtx = pdfCanvas.getContext("2d");

let originalPdfBytes = null;
let pdfDoc = null;
let currentPage = 1;
let textBoxes = []; // { wrapper, inner }
let pdfPageWidth = 0;
let pdfPageHeight = 0;
let renderScale = 1.5;
let activeTextBox = null;

// ===== PDF LOAD =====
pdfFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  statusEl.textContent = "Loading PDF…";

  originalPdfBytes = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({ data: originalPdfBytes });
  pdfDoc = await loadingTask.promise;

  currentPage = 1;
  await renderPage(currentPage);

  reOcrBtn.disabled = false;
  addTextBoxBtn.disabled = false;
  downloadPdfBtn.disabled = false;

  statusEl.textContent = "Recognizing text…";
  await runOcrAndCreateBoxes();
  statusEl.textContent = "Text detected. Click, edit, drag. Delete key removes box.";
});

// ===== Render page =====
async function renderPage(num) {
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: renderScale });

  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  pdfPageWidth = viewport.width;
  pdfPageHeight = viewport.height;

  const renderContext = {
    canvasContext: canvasCtx,
    viewport,
  };

  await page.render(renderContext).promise;

  // Resize container to canvas
  pageContainer.style.width = `${viewport.width}px`;
  pageContainer.style.height = `${viewport.height}px`;

  // Clear old text boxes
  textBoxes.forEach(tb => tb.wrapper.remove());
  textBoxes = [];
  activeTextBox = null;
}

// ===== OCR DETECTION =====
async function runOcrAndCreateBoxes() {
  textBoxes.forEach(tb => tb.wrapper.remove());
  textBoxes = [];
  activeTextBox = null;

  const { Tesseract } = window;
  if (!Tesseract) {
    statusEl.textContent = "Tesseract.js not loaded.";
    return;
  }

  statusEl.textContent = "Recognizing text (OCR)…";

  const result = await Tesseract.recognize(pdfCanvas, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        statusEl.textContent = `Recognizing text… ${Math.round(m.progress * 100)}%`;
      }
    },
  });

  statusEl.textContent = "Placing editable text boxes…";

  const lines = result.data.lines || [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;

    const { x0, y0, x1, y1 } = line.bbox;
    const left = x0;
    const top = y0;
    const width = x1 - x0;
    const height = y1 - y0;

    createTextBox(left, top, width, height, text);
  }

  statusEl.textContent = "Text ready. Edit, drag, and export.";
}

// Re-run OCR
reOcrBtn.addEventListener("click", async () => {
  if (!pdfDoc) return;
  await runOcrAndCreateBoxes();
});

// Add empty box manually
addTextBoxBtn.addEventListener("click", () => {
  if (!pdfDoc) return;
  const x = pdfPageWidth / 2 - 80;
  const y = pdfPageHeight / 2 - 20;
  createTextBox(x, y, 160, 30, "");
});

// ===== Create editable text box (wrapper + inner + handle) =====
function createTextBox(x, y, w, h, initialText = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "text-box";
  wrapper.style.left = x + "px";
  wrapper.style.top = y + "px";

  const inner = document.createElement("div");
  inner.className = "text-inner";
  inner.contentEditable = "true";
  inner.style.width = w + "px";
  inner.style.height = h + "px";
  inner.textContent = initialText;

  // default styles
  inner.style.fontFamily = fontFamilySelect.value;
  inner.style.fontSize = fontSizeSelect.value + "px";
  inner.style.color = fontColorInput.value;
  inner.dataset.bold = "false";
  inner.dataset.italic = "false";
  inner.dataset.underline = "false";

  const handle = document.createElement("div");
  handle.className = "drag-handle";

  wrapper.appendChild(inner);
  wrapper.appendChild(handle);
  pageContainer.appendChild(wrapper);

  const tb = { wrapper, inner };
  textBoxes.push(tb);

  makeDraggable(wrapper, handle);
  setupFocus(wrapper, inner);
  setActiveTextBox(wrapper);
  inner.focus();
}

// ===== Drag logic (handle only) =====
function makeDraggable(wrapper, handle) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(wrapper.style.left);
    startTop = parseFloat(wrapper.style.top);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    wrapper.style.left = startLeft + dx + "px";
    wrapper.style.top = startTop + dy + "px";
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }
}

// ===== Focus & active box =====
function setupFocus(wrapper, inner) {
  inner.addEventListener("focus", () => {
    setActiveTextBox(wrapper);
  });

  wrapper.addEventListener("mousedown", () => {
    setActiveTextBox(wrapper);
  });
}

function setActiveTextBox(wrapper) {
  if (activeTextBox === wrapper) return;
  if (activeTextBox) activeTextBox.classList.remove("active");
  activeTextBox = wrapper;
  if (activeTextBox) activeTextBox.classList.add("active");

  // sync toolbar from inner
  if (activeTextBox) {
    const inner = activeTextBox.querySelector(".text-inner");
    const cs = getComputedStyle(inner);
    fontFamilySelect.value = cs.fontFamily.includes("Patrick")
      ? "'Patrick Hand', cursive"
      : "Inter, sans-serif";
    fontSizeSelect.value = parseInt(cs.fontSize) || 16;
    fontColorInput.value = rgbToHex(cs.color);

    setToolbarButtonState(btnBold, inner.dataset.bold === "true");
    setToolbarButtonState(btnItalic, inner.dataset.italic === "true");
    setToolbarButtonState(btnUnderline, inner.dataset.underline === "true");
  }
}

// Delete active textbox with Delete key
document.addEventListener("keydown", (e) => {
  if (e.key === "Delete" && activeTextBox) {
    const idx = textBoxes.findIndex(tb => tb.wrapper === activeTextBox);
    if (idx !== -1) textBoxes.splice(idx, 1);
    activeTextBox.remove();
    activeTextBox = null;
  }
});

// ===== Toolbar interactions =====
fontFamilySelect.addEventListener("change", () => {
  if (!activeTextBox) return;
  const inner = activeTextBox.querySelector(".text-inner");
  inner.style.fontFamily = fontFamilySelect.value;
});

fontSizeSelect.addEventListener("change", () => {
  if (!activeTextBox) return;
  const inner = activeTextBox.querySelector(".text-inner");
  inner.style.fontSize = fontSizeSelect.value + "px";
});

fontColorInput.addEventListener("input", () => {
  if (!activeTextBox) return;
  const inner = activeTextBox.querySelector(".text-inner");
  inner.style.color = fontColorInput.value;
});

btnBold.addEventListener("click", () => {
  if (!activeTextBox) return;
  const inner = activeTextBox.querySelector(".text-inner");
  const newVal = inner.dataset.bold !== "true";
  inner.dataset.bold = newVal ? "true" : "false";
  inner.style.fontWeight = newVal ? "700" : "400";
  setToolbarButtonState(btnBold, newVal);
});

btnItalic.addEventListener("click", () => {
  if (!activeTextBox) return;
  const inner = activeTextBox.querySelector(".text-inner");
  const newVal = inner.dataset.italic !== "true";
  inner.dataset.italic = newVal ? "true" : "false";
  inner.style.fontStyle = newVal ? "italic" : "normal";
  setToolbarButtonState(btnItalic, newVal);
});

btnUnderline.addEventListener("click", () => {
  if (!activeTextBox) return;
  const inner = activeTextBox.querySelector(".text-inner");
  const newVal = inner.dataset.underline !== "true";
  inner.dataset.underline = newVal ? "true" : "false";
  inner.style.textDecoration = newVal ? "underline" : "none";
  setToolbarButtonState(btnUnderline, newVal);
});

function setToolbarButtonState(btn, active) {
  if (active) btn.classList.add("active");
  else btn.classList.remove("active");
}

// ===== Export edited PDF =====
downloadPdfBtn.addEventListener("click", async () => {
  if (!originalPdfBytes || !pdfDoc) {
    statusEl.textContent = "Upload a PDF first.";
    return;
  }

  statusEl.textContent = "Generating edited PDF…";

  const pdfDocLib = await PDFLib.PDFDocument.load(originalPdfBytes);
  const page = pdfDocLib.getPage(currentPage - 1);
  const { width, height } = page.getSize();

  // Scale factors between canvas (px) and PDF (points)
  const xScale = width / pdfPageWidth;
  const yScale = height / pdfPageHeight;

  // Fonts
  const fonts = {
    normal: await pdfDocLib.embedFont(PDFLib.StandardFonts.Helvetica),
    bold: await pdfDocLib.embedFont(PDFLib.StandardFonts.HelveticaBold),
    italic: await pdfDocLib.embedFont(PDFLib.StandardFonts.HelveticaOblique),
    boldItalic: await pdfDocLib.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
  };

  for (const tb of textBoxes) {
    const wrapper = tb.wrapper;
    const inner = tb.inner;
    const text = inner.textContent;
    if (!text.trim()) continue;

    const rect = wrapper.getBoundingClientRect();
    const containerRect = pageContainer.getBoundingClientRect();

    const xPx = rect.left - containerRect.left;
    const yPx = rect.top - containerRect.top;
    const boxWidthPx = rect.width;
    const boxHeightPx = rect.height;

    // Convert to PDF coordinate system
    const xPdf = xPx * xScale;
    const yPdf = (pdfPageHeight - (yPx + boxHeightPx)) * yScale;
    const boxWidthPdf = boxWidthPx * xScale;
    const boxHeightPdf = boxHeightPx * yScale;

    const cs = getComputedStyle(inner);
    const fontSizePx = parseFloat(cs.fontSize) || 16;
    const pdfFontSize = fontSizePx / renderScale;

    const isBold = inner.dataset.bold === "true";
    const isItalic = inner.dataset.italic === "true";
    const isUnderline = inner.dataset.underline === "true";

    let font;
    if (isBold && isItalic) font = fonts.boldItalic;
    else if (isBold) font = fonts.bold;
    else if (isItalic) font = fonts.italic;
    else font = fonts.normal;

    const color = cssColorToRgb01(cs.color);

    // 1) cover original text
    page.drawRectangle({
      x: xPdf,
      y: yPdf,
      width: boxWidthPdf,
      height: boxHeightPdf,
      color: PDFLib.rgb(1, 1, 1),
    });

    // 2) draw new text
    const lines = text.split(/\n/);
    const lineHeight = pdfFontSize * 1.2;

    lines.forEach((line, idx) => {
      const textWidth = font.widthOfTextAtSize(line, pdfFontSize);
      const textX = xPdf + 2;
      const textY = yPdf + boxHeightPdf - lineHeight * (idx + 1);

      page.drawText(line, {
        x: textX,
        y: textY,
        size: pdfFontSize,
        font,
        color: PDFLib.rgb(color.r, color.g, color.b),
      });

      if (isUnderline && line.trim()) {
        const underlineY = textY - pdfFontSize * 0.15;
        page.drawRectangle({
          x: textX,
          y: underlineY,
          width: textWidth,
          height: pdfFontSize * 0.06,
          color: PDFLib.rgb(color.r, color.g, color.b),
        });
      }
    });
  }

  const editedBytes = await pdfDocLib.save();
  const blob = new Blob([editedBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "astra_edited.pdf";
  a.click();
  URL.revokeObjectURL(url);

  statusEl.textContent = "Edited PDF downloaded.";
});

// ===== Helpers =====
function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m) return "#000000";
  const [r, g, b] = m.map(Number);
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const h = x.toString(16);
        return h.length === 1 ? "0" + h : h;
      })
      .join("")
  );
}

function cssColorToRgb01(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m) return { r: 0, g: 0, b: 0 };
  const [r, g, b] = m.map(Number);
  return { r: r / 255, g: g / 255, b: b / 255 };
}
