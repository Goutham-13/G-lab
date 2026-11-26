const videoURLInput = document.getElementById("videoURL");
const fetchVideoBtn = document.getElementById("fetchVideo");
const videoPreview = document.getElementById("videoPreview");
const downloadVideoBtn = document.getElementById("downloadVideo");
const downloadAudioBtn = document.getElementById("downloadAudio");
const errorMsg = document.getElementById("errorMsg");

fetchVideoBtn.addEventListener("click", async () => {
  const url = videoURLInput.value.trim();
  if(!url){ errorMsg.textContent="Enter a valid URL!"; return; }

  errorMsg.textContent="Fetching video...";
  videoPreview.style.display="none";
  downloadVideoBtn.style.display="none";
  downloadAudioBtn.style.display="none";

  try {
    const res = await fetch("/fetch", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({url})
    });

    const data = await res.json();
    if(res.status!==200){ errorMsg.textContent=data.error||"Failed to fetch video!"; return; }

    errorMsg.textContent="Video fetched! Preview below:";

    videoPreview.src=data.video_url;
    videoPreview.style.display="block";

    downloadVideoBtn.href=data.video_url;
    downloadVideoBtn.style.display="inline-block";

    downloadAudioBtn.href=data.audio_url;
    downloadAudioBtn.style.display="inline-block";

  }catch(err){
    console.error(err);
    errorMsg.textContent="Failed to fetch video. Make sure the URL is correct.";
  }
});
