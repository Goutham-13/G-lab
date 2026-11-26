document.addEventListener('DOMContentLoaded', () => {
  // Auto Year
  document.getElementById('year2').textContent = new Date().getFullYear();

  // Search filter
  const search = document.getElementById('toolSearch');
  const cards = document.querySelectorAll('.card');

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();

    cards.forEach(c => {
      c.style.display = c.dataset.keywords.includes(q) ? '' : 'none';
    });
  });

  // Animate cards on load
  window.addEventListener("load", () => {
    document.querySelectorAll(".card").forEach((c, i) => {
      setTimeout(() => {
        c.classList.add("loaded");
      }, 120 * i);
    });
  });
});
