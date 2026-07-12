const Loading = (() => {
  let stackEl = null;
  let seq = 0;
  const jobs = new Map();

  function ensure() {
    if (!stackEl) stackEl = document.getElementById("loading-stack");
  }

  function getBarEl(job) {
    return job.el?.querySelector(".loading-job-bar");
  }

  function getPercentEl(job) {
    return job.el?.querySelector(".loading-job-percent");
  }

  function getSubtitleEl(job) {
    return job.el?.querySelector(".loading-job-subtitle");
  }

  function renderJobElement(title) {
    const el = document.createElement("div");
    el.className = "loading-job";
    el.innerHTML = `
      <div class="loading-job-top">
        <div class="loading-job-copy">
          <span class="loading-job-title"></span>
          <span class="loading-job-subtitle"></span>
        </div>
        <span class="loading-job-percent">0%</span>
      </div>
      <div class="loading-job-track" aria-hidden="true">
        <div class="loading-job-bar"></div>
      </div>
    `;
    el.querySelector(".loading-job-title").textContent = title;
    return el;
  }

  function setProgress(job, progress, indeterminate = false) {
    const value = Math.max(0, Math.min(100, Math.round(progress)));
    job.progress = value;
    job.indeterminate = indeterminate;

    const bar = getBarEl(job);
    const percent = getPercentEl(job);
    if (!bar || !percent) return;

    job.el.classList.toggle("is-indeterminate", indeterminate);
    if (indeterminate) {
      bar.style.width = "100%";
      percent.textContent = "…";
      return;
    }

    bar.style.width = `${value}%`;
    percent.textContent = `${value}%`;
  }

  function start({ title, subtitle = "Підготовка…" }) {
    ensure();
    if (!stackEl) return null;

    const id = `load-${++seq}`;
    const el = renderJobElement(title || "Документ");
    stackEl.appendChild(el);

    const job = { id, el, title, progress: 0, indeterminate: false, hideTimer: null };
    jobs.set(id, job);
    if (subtitle) getSubtitleEl(job).textContent = subtitle;
    setProgress(job, 0, true);
    el.classList.add("is-entering");
    requestAnimationFrame(() => el.classList.remove("is-entering"));

    return id;
  }

  function update(id, { progress, subtitle, indeterminate } = {}) {
    const job = jobs.get(id);
    if (!job) return;

    if (typeof subtitle === "string") {
      getSubtitleEl(job).textContent = subtitle;
    }
    if (typeof progress === "number") {
      setProgress(job, progress, false);
    } else if (indeterminate === true) {
      setProgress(job, job.progress, true);
    } else if (indeterminate === false) {
      setProgress(job, job.progress, false);
    }
  }

  function finish(id, { message = "Готово", error = false } = {}) {
    const job = jobs.get(id);
    if (!job) return;

    if (job.hideTimer) clearTimeout(job.hideTimer);

    if (error) {
      job.el.classList.add("is-error");
      getSubtitleEl(job).textContent = message;
      setProgress(job, job.progress, false);
      job.hideTimer = setTimeout(() => remove(id), 4200);
      return;
    }

    setProgress(job, 100, false);
    getSubtitleEl(job).textContent = message;
    job.el.classList.add("is-done");
    job.hideTimer = setTimeout(() => remove(id), 1400);
  }

  function complete(id, message) {
    finish(id, { message: message || "Готово" });
  }

  function fail(id, message) {
    finish(id, { message: message || "Помилка", error: true });
  }

  function remove(id) {
    const job = jobs.get(id);
    if (!job) return;
    if (job.hideTimer) clearTimeout(job.hideTimer);
    job.el.classList.add("is-leaving");
    job.el.addEventListener(
      "transitionend",
      () => {
        job.el.remove();
        jobs.delete(id);
      },
      { once: true },
    );
    setTimeout(() => {
      if (jobs.has(id)) {
        job.el.remove();
        jobs.delete(id);
      }
    }, 320);
  }

  function cancel(id) {
    remove(id);
  }

  return { start, update, complete, fail, cancel };
})();
