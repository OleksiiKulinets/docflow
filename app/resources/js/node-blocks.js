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

  function collectBlockIdsInTable(tableEl) {
    if (!tableEl) return [];
    return [...tableEl.querySelectorAll("[data-block-id]")]
      .map((el) => el.getAttribute("data-block-id"))
      .filter(Boolean);
  }

  function getTableBlockIdsForBlock(previewEl, blockId) {
    if (!previewEl || !blockId) return [];
    const block = previewEl.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
    const table = block?.closest("table");
    return table ? collectBlockIdsInTable(table) : [];
  }

  function groupAvailableBlocks(previewEl, availableBlockIds) {
    const availableSet = new Set(availableBlockIds || []);
    const inTable = new Set();
    const tableGroups = [];

    if (previewEl) {
      previewEl.querySelectorAll("table").forEach((table, index) => {
        const blockIds = collectBlockIdsInTable(table).filter((id) => availableSet.has(id));
        if (!blockIds.length) return;
        blockIds.forEach((id) => inTable.add(id));
        tableGroups.push({
          index: index + 1,
          blockIds,
        });
      });
    }

    const standalone = (availableBlockIds || []).filter((id) => !inTable.has(id));
    return { tableGroups, standalone };
  }

  function supportsBlockContent(node) {
    return BLOCK_CONTENT_TYPES.has(node?.type);
  }

  return {
    BLOCK_CONTENT_TYPES,
    truncate,
    listPreviewBlockIds,
    blockPreviewText,
    collectBlockIdsInTable,
    getTableBlockIdsForBlock,
    groupAvailableBlocks,
    supportsBlockContent,
  };
})();
