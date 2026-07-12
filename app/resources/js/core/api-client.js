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
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  return { waitForApi, decodeHtml, encodeHtml };
})();
