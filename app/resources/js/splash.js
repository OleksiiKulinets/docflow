const Splash = (() => {
  let splashEl = null;
  let shellEl = null;
  let statusEl = null;
  let progressEl = null;

  const MIN_INTRO_MS = 1400;
  const MIN_EXIT_MS = 900;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitTransition(element, fallbackMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        element.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (event) => {
        if (event.target === element) finish();
      };
      element.addEventListener("transitionend", onEnd);
      setTimeout(finish, fallbackMs);
    });
  }

  function init() {
    splashEl = document.getElementById("splash");
    shellEl = document.getElementById("app-shell");
    statusEl = document.getElementById("splash-status");
    progressEl = document.getElementById("splash-progress-bar");
    document.body.classList.add("is-booting");
  }

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function setProgress(value) {
    if (!progressEl) return;
    const clamped = Math.max(0, Math.min(100, value));
    progressEl.style.width = `${clamped}%`;
    splashEl?.classList.toggle("is-indeterminate", clamped <= 0);
  }

  async function run(bootstrap) {
    if (!splashEl || !shellEl) init();
    if (!splashEl || !shellEl) {
      await bootstrap?.({});
      return;
    }

    const introStarted = performance.now();
    setProgress(8);
    setStatus("Запуск…");

    await delay(420);
    setStatus("Ініціалізація інтерфейсу…");
    setProgress(22);

    const bootstrapStarted = performance.now();
    await bootstrap({ setStatus, setProgress });
    const bootstrapElapsed = performance.now() - bootstrapStarted;

    setProgress(100);
    setStatus("Ласкаво просимо");

    const introElapsed = performance.now() - introStarted;
    const remainingIntro = Math.max(0, MIN_INTRO_MS - introElapsed);
    const remainingBootstrap = Math.max(0, 520 - bootstrapElapsed);
    await delay(Math.max(remainingIntro, remainingBootstrap, 280));

    await exit();
  }

  async function exit() {
    if (!splashEl || !shellEl) return;

    splashEl.classList.add("is-exiting");
    splashEl.setAttribute("aria-hidden", "true");
    shellEl.classList.add("is-revealed");
    document.body.classList.remove("is-booting");
    document.body.classList.add("is-ready");

    await waitTransition(shellEl, MIN_EXIT_MS + 200);

    splashEl.classList.remove("is-active");
    splashEl.remove();
    splashEl = null;
  }

  return { init, run, setStatus, setProgress };
})();
