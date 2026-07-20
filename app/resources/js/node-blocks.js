/** Preview block helpers for Node Editor (UI-3A). */

const NodeBlocks = (() => {
  const BLOCK_CONTENT_TYPES = new Set(["paragraph", "table", "marker"]);

  function truncate(text, limit = 72) {
    if (!text) return "";
    return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
  }

  function listPreviewBlockIds(previewEl) {
    if (!previewEl) return [];
    return [...previewEl.querySelectorAll("[data-block-id]")]
      .map((el) => el.getAttribute("data-block-id"))
      .filter(Boolean);
  }

  function blockPreviewText(previewEl, blockId) {
    if (!previewEl || !blockId) return "";
    const el = previewEl.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
    const text = (el?.textContent || "").replace(/\s+/g, " ").trim();
    return text || blockId;
  }

  function supportsBlockContent(node) {
    return BLOCK_CONTENT_TYPES.has(node?.type);
  }

  return {
    BLOCK_CONTENT_TYPES,
    truncate,
    listPreviewBlockIds,
    blockPreviewText,
    supportsBlockContent,
  };
})();
