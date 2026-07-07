const Editor = (() => {
  const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
  const ZWSP = "\u200B";
  const NBSP = "\u00A0";
  const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, .docx-p, .docx-cell-p";

  let enabled = false;
  let savedRange = null;
  let normalizeTimer = null;
  let editableBound = false;

  const els = {
    chrome: document.getElementById("word-chrome"),
    ribbon: document.getElementById("word-ribbon"),
    font: document.getElementById("fmt-font"),
    size: document.getElementById("fmt-size"),
    style: document.getElementById("fmt-style"),
    lineHeight: document.getElementById("fmt-line-height"),
    color: document.getElementById("fmt-color"),
    highlight: document.getElementById("fmt-highlight"),
    grow: document.getElementById("fmt-grow"),
    shrink: document.getElementById("fmt-shrink"),
  };

  function getEditable() {
    return document.querySelector(".docx-editable");
  }

  function asElement(node) {
    if (!node) return null;
    return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const editable = getEditable();
    if (editable && editable.contains(range.commonAncestorContainer)) {
      savedRange = range.cloneRange();
    }
  }

  function restoreSelection() {
    if (!savedRange) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  }

  function focusEditable() {
    const el = getEditable();
    if (el) el.focus({ preventScroll: true });
    return el;
  }

  function getTableCell(node) {
    return asElement(node)?.closest("td, th") || null;
  }

  function getBlockElement(node) {
    const editable = getEditable();
    if (!editable) return null;

    const el = asElement(node);
    if (!el) return null;

    const cell = el.closest("td, th");
    if (cell) {
      const cellBlock = el.closest(BLOCK_SELECTOR);
      if (cellBlock && cell.contains(cellBlock)) return cellBlock;
      return ensureCellParagraph(cell);
    }

    const block = el.closest(`${BLOCK_SELECTOR}, div`);
    return block && editable.contains(block) ? block : null;
  }

  function ensureCellParagraph(cell) {
    let block = cell.querySelector(":scope > p.docx-cell-p, :scope > p.docx-p, :scope > p");
    if (!block) {
      block = document.createElement("p");
      block.className = "docx-p docx-cell-p";
      block.style.margin = "0";
      block.innerHTML = NBSP;
      cell.appendChild(block);
    }
    return block;
  }

  function cellTextContent(cell) {
    return (cell.textContent || "").replace(ZWSP, "").replace(NBSP, " ").trim();
  }

  function isCellEmpty(cell) {
    const blocks = [...cell.children].filter((n) => n.nodeType === Node.ELEMENT_NODE);
    if (!blocks.length) return true;
    return blocks.every((block) => {
      const text = (block.textContent || "").replace(ZWSP, "").replace(NBSP, " ").trim();
      return !text && !block.querySelector("img, br");
    });
  }

  function getCaretOffsetInCell(sel, cell) {
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!cell.contains(range.startContainer)) return null;

    const pre = document.createRange();
    pre.selectNodeContents(cell);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function isCaretAtCellStart(sel, cell) {
    if (!sel?.isCollapsed) return false;
    const offset = getCaretOffsetInCell(sel, cell);
    return offset === 0;
  }

  function isCaretAtCellEnd(sel, cell) {
    if (!sel?.isCollapsed) return false;
    const offset = getCaretOffsetInCell(sel, cell);
    if (offset === null) return false;
    const full = (cell.textContent || "").replace(ZWSP, "");
    return offset >= full.length;
  }

  function selectionTouchesTableBoundary(sel) {
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const startCell = getTableCell(range.startContainer);
    const endCell = getTableCell(range.endContainer);
    if (!startCell && !endCell) return false;
    if (!sel.isCollapsed && startCell !== endCell) return true;

    const editable = getEditable();
    if (!editable) return false;

    const cells = [...editable.querySelectorAll("td, th")];
    const fragment = range.cloneContents();
    const touched = [...fragment.querySelectorAll("td, th, tr, table, tbody")];
    if (touched.length) return true;

    return cells.some((cell) => range.intersectsNode(cell) && !cell.contains(range.commonAncestorContainer));
  }

  function normalizeCell(cell) {
    [...cell.querySelectorAll(":scope > div")].forEach((div) => {
      const p = document.createElement("p");
      p.className = "docx-p docx-cell-p";
      p.style.margin = "0";
      p.innerHTML = div.innerHTML || NBSP;
      div.replaceWith(p);
    });

    const blocks = [...cell.children].filter((n) => n.nodeType === Node.ELEMENT_NODE);
    if (!blocks.length) {
      const p = document.createElement("p");
      p.className = "docx-p docx-cell-p";
      p.style.margin = "0";
      p.innerHTML = cellTextContent(cell) || NBSP;
      cell.textContent = "";
      cell.appendChild(p);
      return;
    }

    blocks.forEach((block) => {
      if (block.tagName === "BR") {
        block.remove();
        return;
      }
      block.classList.add("docx-p", "docx-cell-p");
      if (!block.style.margin) block.style.margin = "0";
      const text = (block.textContent || "").replace(ZWSP, "").replace(NBSP, " ").trim();
      if (!text && !block.querySelector("img")) {
        block.textContent = "";
        block.appendChild(document.createTextNode(NBSP));
      }
    });
  }

  function normalizeTables(root) {
    root.querySelectorAll("tr").forEach((row) => {
      if (!row.querySelector("td, th")) row.remove();
    });

    root.querySelectorAll("table").forEach((table) => {
      if (!table.querySelector("tr")) {
        table.remove();
        return;
      }
      if (!table.querySelector("tbody")) {
        const tbody = document.createElement("tbody");
        [...table.querySelectorAll(":scope > tr")].forEach((row) => tbody.appendChild(row));
        table.appendChild(tbody);
      }
      table.querySelectorAll("td, th").forEach(normalizeCell);
    });

    root.querySelectorAll("td, th, tr, tbody").forEach((node) => {
      if (!node.closest("table")) node.remove();
    });
  }

  function normalizeParagraphs(root) {
    root.querySelectorAll("p").forEach((p) => {
      if (p.closest("table")) return;
      const text = (p.textContent || "").replace(ZWSP, "").replace(NBSP, " ").trim();
      if (!text && !p.querySelector("img, br")) {
        p.textContent = "";
        p.appendChild(document.createTextNode(NBSP));
      }
    });
  }

  function stripArtifacts(root) {
    root.querySelectorAll("span").forEach((span) => {
      const style = span.getAttribute("style") || "";
      const hasStyle = /font-size|font-family|color|background|font-weight|font-style/i.test(style);
      const text = (span.textContent || "").replace(ZWSP, "").trim();
      if (!text && !span.children.length && !hasStyle) {
        span.remove();
      }
    });
    root.querySelectorAll("font").forEach((font) => {
      const parent = font.parentNode;
      while (font.firstChild) parent.insertBefore(font.firstChild, font);
      font.remove();
    });
  }

  function normalizeDocument(editable = getEditable()) {
    if (!editable) return editable;

    normalizeTables(editable);
    normalizeParagraphs(editable);
    stripArtifacts(editable);
    return editable;
  }

  function scheduleNormalize() {
    clearTimeout(normalizeTimer);
    normalizeTimer = setTimeout(() => {
      const editable = getEditable();
      if (!editable) return;
      saveSelection();
      normalizeDocument(editable);
      restoreSelection();
    }, 80);
  }

  function deleteSelectionInTable(sel) {
    document.execCommand("delete");
    normalizeDocument();
    saveSelection();
  }

  function handleTableKeydown(event) {
    if (!enabled || (event.key !== "Backspace" && event.key !== "Delete")) return;

    const editable = getEditable();
    const sel = window.getSelection();
    if (!editable || !sel?.rangeCount) return;

    const anchorCell = getTableCell(sel.anchorNode);
    const focusCell = getTableCell(sel.focusNode);
    if (!anchorCell && !focusCell) return;

    if (!sel.isCollapsed || selectionTouchesTableBoundary(sel)) {
      event.preventDefault();
      deleteSelectionInTable(sel);
      return;
    }

    const cell = anchorCell || focusCell;
    if (!cell) return;

    if (event.key === "Backspace" && isCaretAtCellStart(sel, cell)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Delete" && isCaretAtCellEnd(sel, cell) && isCellEmpty(cell)) {
      event.preventDefault();
      ensureCellParagraph(cell).innerHTML = NBSP;
      return;
    }

    scheduleNormalize();
  }

  function bindEditable() {
    if (editableBound) return;
    editableBound = true;

    document.addEventListener(
      "input",
      (event) => {
        if (!enabled) return;
        const editable = getEditable();
        if (!editable || !editable.contains(event.target)) return;
        scheduleNormalize();
      },
      true,
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (!enabled) return;
        const editable = getEditable();
        if (!editable || !editable.contains(event.target)) return;
        handleTableKeydown(event);
      },
      true,
    );

    document.addEventListener(
      "paste",
      (event) => {
        if (!enabled) return;
        const editable = getEditable();
        if (!editable || !editable.contains(event.target)) return;
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") || "";
        if (text) {
          document.execCommand("insertText", false, text);
        }
        scheduleNormalize();
      },
      true,
    );
  }

  function exec(command, value = null) {
    restoreSelection();
    focusEditable();

    const sel = window.getSelection();
    const inTable = sel?.rangeCount && getTableCell(sel.anchorNode);
    if (inTable && command === "formatBlock") {
      return;
    }

    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    saveSelection();
    normalizeDocument();
    saveSelection();
    syncState();
  }

  function wrapSelectionWithStyle(styles) {
    restoreSelection();
    const editable = focusEditable();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editable) return;

    const range = sel.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer)) return;

    const span = document.createElement("span");
    Object.assign(span.style, styles);

    if (range.collapsed) {
      span.appendChild(document.createTextNode(ZWSP));
      range.insertNode(span);
      const newRange = document.createRange();
      newRange.setStart(span.firstChild, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      try {
        range.surroundContents(span);
      } catch {
        const content = range.extractContents();
        span.appendChild(content);
        range.insertNode(span);
      }
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    savedRange = sel.getRangeAt(0).cloneRange();
    syncState();
  }

  function applyFontName(name) {
    restoreSelection();
    focusEditable();
    document.execCommand("styleWithCSS", false, "true");
    const ok = document.execCommand("fontName", false, name);
    if (!ok) wrapSelectionWithStyle({ fontFamily: `'${name}', Calibri, sans-serif` });
    saveSelection();
    normalizeDocument();
    saveSelection();
    syncState();
  }

  function applyFontSize(pt) {
    restoreSelection();
    focusEditable();
    document.execCommand("styleWithCSS", false, "true");

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      wrapSelectionWithStyle({ fontSize: `${pt}pt` });
      return;
    }

    wrapSelectionWithStyle({ fontSize: `${pt}pt` });
  }

  function changeFontSize(delta) {
    const current = parseInt(els.size.value, 10) || 11;
    let index = FONT_SIZES.indexOf(current);
    if (index === -1) {
      index = FONT_SIZES.findIndex((s) => s >= current);
      if (index === -1) index = FONT_SIZES.length - 1;
    }
    const next = Math.max(0, Math.min(FONT_SIZES.length - 1, index + delta));
    els.size.value = String(FONT_SIZES[next]);
    applyFontSize(FONT_SIZES[next]);
  }

  function applyStyle(tag) {
    const sel = window.getSelection();
    if (sel?.rangeCount && getTableCell(sel.anchorNode)) return;
    const blockTag = tag === "p" ? "p" : tag;
    exec("formatBlock", `<${blockTag}>`);
  }

  function applyLineHeight(value) {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const block = getBlockElement(sel.anchorNode);
    if (!block) return;

    block.style.lineHeight = value;
    if (!block.closest("td, th")) {
      block.style.margin = "0";
      block.style.marginBottom = block.tagName.toLowerCase() === "p" ? "8pt" : "";
    }
    saveSelection();
    syncState();
  }

  function applyColor(input, command) {
    restoreSelection();
    focusEditable();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, input.value);
    const bar = input.closest(".ribbon-color")?.querySelector(".ribbon-color-bar");
    if (bar) bar.style.background = input.value;
    saveSelection();
    syncState();
  }

  function queryCommandState(command) {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  }

  function queryValue(command) {
    try {
      return document.queryCommandValue(command);
    } catch {
      return "";
    }
  }

  function syncToggleButtons() {
    document.querySelectorAll(".ribbon-btn-toggle[data-cmd]").forEach((btn) => {
      btn.classList.toggle("is-active", queryCommandState(btn.dataset.cmd));
    });
  }

  function syncState() {
    if (!enabled) return;

    restoreSelection();
    syncToggleButtons();

    const font = queryValue("fontName").replace(/['"]/g, "");
    if (font) {
      for (const option of els.font.options) {
        if (font.toLowerCase().includes(option.value.toLowerCase())) {
          els.font.value = option.value;
          break;
        }
      }
    }

    const sel = window.getSelection();
    let node = sel?.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;

    const sized = node?.closest?.("span[style*='font-size'], font[style*='font-size']");
    const sizeText = sized?.style?.fontSize || "";
    const pt = parseInt(sizeText, 10);
    if (pt && FONT_SIZES.includes(pt)) els.size.value = String(pt);

    const block = getBlockElement(node);
    if (block && !block.closest("td, th")) {
      const tag = block.tagName.toLowerCase();
      if (["p", "h1", "h2", "h3"].includes(tag)) els.style.value = tag;
      if (block.style.lineHeight) els.lineHeight.value = block.style.lineHeight;
    }
  }

  function bindRibbon() {
    const chrome = els.chrome || els.ribbon;
    chrome?.addEventListener("mousedown", (event) => {
      if (event.target.closest("select, input[type='color']")) {
        saveSelection();
        return;
      }
      event.preventDefault();
      saveSelection();
    });

    document.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cmd = btn.dataset.cmd;
        if (cmd === "paste") {
          navigator.clipboard?.readText()
            .then((text) => { if (text) exec("insertText", text); })
            .catch(() => exec("paste"));
          return;
        }
        if (cmd === "subscript" && queryCommandState("superscript")) {
          exec("superscript");
        }
        if (cmd === "superscript" && queryCommandState("subscript")) {
          exec("subscript");
        }
        exec(cmd);
      });
    });

    els.font?.addEventListener("mousedown", saveSelection);
    els.font?.addEventListener("change", () => applyFontName(els.font.value));

    els.size?.addEventListener("mousedown", saveSelection);
    els.size?.addEventListener("change", () => applyFontSize(parseInt(els.size.value, 10)));

    els.style?.addEventListener("mousedown", saveSelection);
    els.style?.addEventListener("change", () => applyStyle(els.style.value));

    els.lineHeight?.addEventListener("mousedown", saveSelection);
    els.lineHeight?.addEventListener("change", () => applyLineHeight(els.lineHeight.value));

    els.color?.addEventListener("mousedown", saveSelection);
    els.color?.addEventListener("input", () => applyColor(els.color, "foreColor"));

    els.highlight?.addEventListener("mousedown", saveSelection);
    els.highlight?.addEventListener("input", () => applyColor(els.highlight, "backColor"));

    els.grow?.addEventListener("click", () => changeFontSize(1));
    els.shrink?.addEventListener("click", () => changeFontSize(-1));

    document.addEventListener("selectionchange", () => {
      if (!enabled) return;
      const el = getEditable();
      const sel = window.getSelection();
      if (el && sel?.rangeCount && el.contains(sel.anchorNode)) {
        saveSelection();
        syncState();
      }
    });
  }

  function prepareEditable() {
    const editable = getEditable();
    if (!editable) return;
    normalizeDocument(editable);
  }

  function getHtml() {
    const editable = getEditable();
    if (!editable) return "";
    normalizeDocument(editable);
    return editable.innerHTML;
  }

  function setEnabled(isEnabled) {
    enabled = isEnabled;
    if (els.chrome) els.chrome.hidden = !isEnabled;
    if (isEnabled) {
      prepareEditable();
      syncState();
    }
  }

  function init() {
    bindRibbon();
    bindEditable();
  }

  return { init, setEnabled, syncState, getEditable, prepareEditable, getHtml };
})();

Editor.init();
