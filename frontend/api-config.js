/**
 * CleanLab — API Base URL Configuration & Smart Resolver
 *
 * Set window.CLEANLAB_API_BASE to your backend URL when you have one hosted.
 * Leave as "" to auto-detect the local Python server at 127.0.0.1:8000.
 *
 * Example (once you have a backend host):
 *   window.CLEANLAB_API_BASE = "https://your-backend-url.com";
 */
window.CLEANLAB_API_BASE = "";

window.resolveCleanLabApiBase = async function resolveCleanLabApiBase() {
  const configured = window.CLEANLAB_API_BASE
    ? String(window.CLEANLAB_API_BASE).replace(/\/$/, "")
    : "";

  const candidates = [];
  if (configured) candidates.push(configured);
  if (!candidates.includes("http://127.0.0.1:8000")) candidates.push("http://127.0.0.1:8000");
  if (location.protocol !== "file:" && !candidates.includes(""))  candidates.push("");

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
