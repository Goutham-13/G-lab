/**
 * CleanLab — API Base URL Configuration & Smart Resolver
 *
 * Backend is hosted on Render: https://clean-lab.onrender.com
 * Frontend is hosted on Vercel: https://g-lab.vercel.app
 *
 * Local dev (127.0.0.1 / localhost): checks local server first, then Render.
 * Production (Vercel): checks CLEANLAB_API_BASE (Render), then falls back to 127.0.0.1:8000 if running locally.
 */
window.CLEANLAB_API_BASE = "https://clean-lab.onrender.com";

window.resolveCleanLabApiBase = async function resolveCleanLabApiBase() {
  const configured = window.CLEANLAB_API_BASE
    ? String(window.CLEANLAB_API_BASE).replace(/\/$/, "")
    : "";
  const isLocalHost =
    location.hostname === "127.0.0.1" || location.hostname === "localhost";

  const candidates = [];
  if (location.protocol !== "file:" && isLocalHost) {
    candidates.push("");
  }
  if (configured) {
    candidates.push(configured);
  }
  if (location.protocol !== "file:" && !isLocalHost) {
    candidates.push("");
  }
  if (!candidates.includes("http://127.0.0.1:8000")) {
    candidates.push("http://127.0.0.1:8000");
  }

  for (const base of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(`${base}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) return base;
    } catch {}
  }
  return null;
};
