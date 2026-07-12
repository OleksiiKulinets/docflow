const AppUtils = (() => {
  const ALLOWED_EXTENSIONS = [".docx", ".txt", ".pdf"];

  function isAllowedFile(file) {
    const name = file.name.toLowerCase();
    return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  }

  function readFileAsBase64(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      if (onProgress) {
        reader.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
      }
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    return date.toLocaleString("uk-UA", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return {
    ALLOWED_EXTENSIONS,
    isAllowedFile,
    readFileAsBase64,
    escapeHtml,
    formatSize,
    formatDate,
  };
})();
