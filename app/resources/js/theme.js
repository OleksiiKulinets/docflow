const Theme = (() => {
  const STORAGE_KEY = "docflow-theme";

  let switchEl = null;
  let toggleBtn = null;

  function updateAria(isDark) {
    if (!switchEl) return;
    switchEl.classList.toggle("is-dark", isDark);
    switchEl.setAttribute("aria-checked", String(isDark));
    switchEl.setAttribute(
      "aria-label",
      isDark ? "Тема: темна" : "Тема: світла",
    );
    toggleBtn?.setAttribute(
      "title",
      isDark ? "Увімкнути світлу тему" : "Увімкнути темну тему",
    );
  }

  function apply(theme) {
    const isDark = theme === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    updateAria(isDark);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  }

  function toggle() {
    apply(currentTheme() === "dark" ? "light" : "dark");
    toggleBtn?.classList.add("is-clicked");
    window.setTimeout(() => toggleBtn?.classList.remove("is-clicked"), 180);
  }

  function init() {
    switchEl = document.getElementById("theme-switch");
    toggleBtn = document.getElementById("theme-toggle");
    if (!switchEl || !toggleBtn) return;

    const saved = localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    apply(saved || (prefersDark ? "dark" : "light"));

    toggleBtn.addEventListener("click", toggle);
  }

  return { init, apply, toggle, currentTheme };
})();
