// audio.js
// Ensure this script is included at the end of audio.html (before </body>)

const dropArea = document.getElementById("dropArea");
const audioFile = document.getElementById("audioFile");
const convertBtn = document.getElementById("convertBtn");
const fileName = document.getElementById("fileName");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const statusText = document.getElementById("statusText");
const resultWrap = document.getElementById("resultWrap");
const audioPreview = document.getElementById("audioPreview");
const downloadBtn = document.getElementById("downloadBtn");
const errorBox = document.getElementById("error");
const closeBtn = document.getElementById("closeBtn");
const overlay = document.getElementById("audioOverlay");

let selectedFile = null;

function resetUI(){
  progressBar.style.width = "0%";
  progressWrap.classList.add("hidden");
  statusText.textContent = "";
  resultWrap.classList.add("hidden");
  audioPreview.src = "";
  downloadBtn.href = "";
  errorBox.textContent = "";
}

// open file chooser on click
dropArea.addEventListener("click", () => audioFile.click());
dropArea.addEventListener("keydown", (e) => { if(e.key === "Enter") audioFile.click(); });

// handle file selection
audioFile.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) {
    selectedFile = e.target.files[0];
    fileName.textContent = selectedFile.name;
    convertBtn.disabled = false;
    resetUI();
  }
});

// drag & drop support
dropArea.addEventListener("dragover", (e) => { e.preventDefault(); dropArea.classList.add("dragover"); });
dropArea.addEventListener("dragleave", (e) => { dropArea.classList.remove("dragover"); });
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    selectedFile = e.dataTransfer.files[0];
    audioFile.files = e.dataTransfer.files; // populate input for accessibility
    fileName.textContent = selectedFile.name;
    convertBtn.disabled = false;
    resetUI();
  }
});

// close popup
closeBtn.addEventListener("click", () => { overlay.style.display = "none"; });

// convert action
convertBtn.addEventListener("click", async () => {
  errorBox.textContent = "";
  if (!selectedFile) { errorBox.textContent = "Please select a file."; return; }

  // UI state
  progressWrap.classList.remove("hidden");
  progressBar.style.width = "10%";
  statusText.textContent = "Uploading file...";

  // Prepare FormData
  const form = new FormData();
  form.append("file", selectedFile);

  try {
    // upload + convert (POST)
    const resp = await fetch("http://127.0.0.1:5000/convert", {
      method: "POST",
      body: form
    });

    if (!resp.ok) {
      const err = await resp.json().catch(()=>({error: 'Conversion failed'}));
      errorBox.textContent = err.error || "Conversion failed";
      statusText.textContent = "Failed";
      progressBar.style.width = "0%";
      return;
    }

    // update UI
    statusText.textContent = "Preparing download...";
    progressBar.style.width = "80%";

    // read blob
    const blob = await resp.blob();

    // finalize UI
    const url = URL.createObjectURL(blob);
    audioPreview.src = url;
    downloadBtn.href = url;
    resultWrap.classList.remove("hidden");

    // auto-trigger download
    downloadBtn.click();

    progressBar.style.width = "100%";
    statusText.textContent = "Complete";

  } catch (err) {
    console.error(err);
    errorBox.textContent = "Network error or server not running.";
    statusText.textContent = "Error";
    progressBar.style.width = "0%";
  }
});
