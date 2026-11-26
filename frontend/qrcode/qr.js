const qrText = document.getElementById("qrText");
const clearInput = document.getElementById("clearInput");
const generateQR = document.getElementById("generateQR");
const loader = document.getElementById("loader");
const qrResult = document.getElementById("qrResult");
const downloadQR = document.getElementById("downloadQR");
const closePopup = document.getElementById("closePopup");

let currentCanvas = null;

// Clear input
clearInput.addEventListener("click", () => {
  qrText.value = "";
  clearInput.style.display = "none";
  qrResult.innerHTML = "";
  downloadQR.style.display = "none";
  qrText.focus();
});

// Show/hide clear button
qrText.addEventListener("input", () => {
  clearInput.style.display = qrText.value ? "block" : "none";
});

// Generate QR
generateQR.addEventListener("click", async () => {
  const text = qrText.value.trim();
  if (!text) {
    alert("Please enter some text or a link!");
    return;
  }

  loader.style.display = "block";
  qrResult.innerHTML = "";
  downloadQR.style.display = "none";

  try {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, text, { width: 240, color: { dark: "#000000ff", light: "#ffffffff" } });
    currentCanvas = canvas;

    setTimeout(() => {
      loader.style.display = "none";
      qrResult.appendChild(canvas);
      downloadQR.style.display = "inline-block";
    }, 600);
  } catch (err) {
    loader.style.display = "none";
    alert("Error generating QR. Please try again.");
  }
});

// Download QR
downloadQR.addEventListener("click", () => {
  if (!currentCanvas) return;
  const link = document.createElement("a");
  link.download = "Astra-QR.png";
  link.href = currentCanvas.toDataURL("image/png");
  link.click();
});

// Close popup (back to home)
closePopup.addEventListener("click", () => {
  window.location.href = "../index.html";
});

// Change popup background dynamically
function setPopupBackground(color) {
  const popup = document.querySelector('.popup');
  popup.style.background = color; // e.g. 'rgba(123,97,255,0.12)'
}

// Change QR foreground color
function setQRCodeColor(color) {
  const qrCanvas = document.querySelector('#qrResult canvas');
  if (!qrCanvas) return;
  const ctx = qrCanvas.getContext('2d');
  const imgData = ctx.getImageData(0,0,qrCanvas.width,qrCanvas.height);
  for (let i=0;i<imgData.data.length;i+=4){
    if(imgData.data[i+3]!==0){ // only non-transparent pixels
      imgData.data[i] = parseInt(color.slice(1,3),16);
      imgData.data[i+1] = parseInt(color.slice(3,5),16);
      imgData.data[i+2] = parseInt(color.slice(5,7),16);
    }
  }
  ctx.putImageData(imgData,0,0);
}
