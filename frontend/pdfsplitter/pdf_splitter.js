const pdfFileInput = document.getElementById("pdfFile");
const totalPagesInput = document.getElementById("totalPages");
const numSplitsInput = document.getElementById("numSplits");
const rangeInputsDiv = document.getElementById("rangeInputs");
const errorMsg = document.getElementById("errorMsg");
const generateSplitsBtn = document.getElementById("generateSplits");
const downloadLinksDiv = document.getElementById("downloadLinks");
const closePopup = document.getElementById("closePopup");
const splitHint = document.getElementById("splitHint");

// Overlap modal elements
const overlapModal = document.getElementById("overlapModal");
const overlapMsg = document.getElementById("overlapMsg");
const confirmOverlapBtn = document.getElementById("confirmOverlap");
const cancelOverlapBtn = document.getElementById("cancelOverlap");

let pdfDoc = null;
let totalPages = 0;
let pendingRanges = null;

// Load PDF
pdfFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const arrayBuffer = await file.arrayBuffer();
  pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
  totalPages = pdfDoc.getPageCount();
  totalPagesInput.value = totalPages;
  rangeInputsDiv.innerHTML = "";
  errorMsg.textContent = "";
  downloadLinksDiv.innerHTML = "";
  splitHint.textContent = `You can split this PDF into 1 to ${totalPages} parts.`;
});

// Generate dynamic inputs for splits
numSplitsInput.addEventListener("input", () => {
  const splits = parseInt(numSplitsInput.value);
  rangeInputsDiv.innerHTML = "";
  downloadLinksDiv.innerHTML = "";
  errorMsg.textContent = "";

  if (!pdfDoc) return;
  if (isNaN(splits) || splits < 1 || splits > totalPages) {
    splitHint.textContent = `Invalid. You can split maximum ${totalPages} times.`;
    return;
  }
  splitHint.textContent = "";

  for (let i = 0; i < splits; i++) {
    const wrapper = document.createElement("div");
    wrapper.className = "input-wrap";
    wrapper.innerHTML = `
      <label>Split ${i + 1} range (start-end):</label>
      <input type="text" class="range-input" placeholder="e.g. 1-5">
    `;
    rangeInputsDiv.appendChild(wrapper);
  }
});

// Validate ranges and check overlaps
function validateRanges() {
  const inputs = document.querySelectorAll(".range-input");
  const ranges = [];
  errorMsg.textContent = "";

  for (let inp of inputs) {
    const val = inp.value.trim();
    if (!/^\d+\s*-\s*\d+$/.test(val)) {
      errorMsg.textContent = "Invalid format! Use start-end (e.g. 1-3).";
      return null;
    }
    let [start, end] = val.split("-").map(Number);
    if (start < 1 || end > totalPages || start > end) {
      errorMsg.textContent = `Range ${start}-${end} is invalid! PDF has ${totalPages} pages.`;
      return null;
    }
    ranges.push([start, end]);
  }

  // Check for overlapping ranges
  let pageUsed = new Set();
  let overlapping = false;
  for (let [start, end] of ranges) {
    for (let p = start; p <= end; p++) {
      if (pageUsed.has(p)) overlapping = true;
      pageUsed.add(p);
    }
  }

  return { ranges, overlapping };
}

// Split PDF using pdf-lib
async function splitPDF(ranges) {
  downloadLinksDiv.innerHTML = "";
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    const newPdf = await PDFLib.PDFDocument.create();
    for (let p = start - 1; p < end; p++) {
      const [copiedPage] = await newPdf.copyPages(pdfDoc, [p]);
      newPdf.addPage(copiedPage);
    }
    const pdfBytes = await newPdf.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `split_${i + 1}.pdf`;
    link.textContent = `Download split ${i + 1} (${start}-${end})`;
    downloadLinksDiv.appendChild(link);
  }
}

// Generate splits button
generateSplitsBtn.addEventListener("click", async () => {
  if (!pdfDoc) {
    errorMsg.textContent = "Upload a PDF first!";
    return;
  }
  const { ranges, overlapping } = validateRanges() || {};
  if (!ranges) return;

  if (overlapping) {
    pendingRanges = ranges;
    overlapMsg.textContent = "Some page ranges are overlapping. Do you want to proceed anyway?";
    overlapModal.style.display = "flex";
  } else {
    await splitPDF(ranges);
  }
});

// Modal actions
confirmOverlapBtn.addEventListener("click", async () => {
  overlapModal.style.display = "none";
  if (pendingRanges) {
    await splitPDF(pendingRanges);
    pendingRanges = null;
  }
});
cancelOverlapBtn.addEventListener("click", () => {
  overlapModal.style.display = "none";
  pendingRanges = null;
});

// Close popup
closePopup.addEventListener("click", () => window.location.href = "../index.html");
