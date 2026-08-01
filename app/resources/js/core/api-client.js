const ApiClient = (() => {
  function waitForApi() {
    return new Promise((resolve) => {
      if (window.pywebview?.api) {
        resolve();
        return;
      }
      window.addEventListener("pywebviewready", resolve, { once: true });
    });
  }

  function decodeHtml(payload, field) {
    const raw = payload?.[field];
    if (!raw) return "";
    if (payload?.html_encoding?.[field] === "base64") {
      const bytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    }
    return raw;
  }

  function encodeHtml(html) {
    if (!html) return "";
    const bytes = new TextEncoder().encode(html);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  return { waitForApi, decodeHtml, encodeHtml };
})();
