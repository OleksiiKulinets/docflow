const Unsaved = (() => {
  let htmlBaseline = "";
  let rulesBaseline = "";
  let ctx = {};

  function bind(context) {
    ctx = context;
  }

  function captureHtml() {
    if (typeof ctx.captureHtml === "function") {
      return ctx.captureHtml();
    }
    return "";
  }

  function captureRules() {
    if (typeof ctx.captureRules === "function") {
      return ctx.captureRules();
    }
    return "";
  }

  function reset() {
    htmlBaseline = captureHtml();
    rulesBaseline = captureRules();
  }

  function hasChanges() {
    return htmlChanged() || rulesChanged();
  }

  function htmlChanged() {
    const currentFileId = ctx.getCurrentFileId?.();
    const currentExtension = ctx.getCurrentExtension?.();
    const activeTab = ctx.getActiveTab?.();
    const sessionInnerHtml = ctx.getSessionInnerHtml?.();

    if (!currentFileId || currentExtension === ".pdf") return false;
    if (currentExtension !== ".docx" && currentExtension !== ".txt") return false;
    if (currentExtension === ".docx" && activeTab === "edit") {
      if (sessionInnerHtml?.trim()) return sessionInnerHtml !== htmlBaseline;
      return false;
    }
    return captureHtml() !== htmlBaseline;
  }

  function rulesChanged() {
    const currentFileId = ctx.getCurrentFileId?.();
    const currentExtension = ctx.getCurrentExtension?.();

    if (!currentFileId || currentExtension !== ".docx") return false;
    return rulesBaseline !== captureRules();
  }

  function syncRulesBaseline() {
    rulesBaseline = captureRules();
  }

  return { bind, reset, syncRulesBaseline, hasChanges, htmlChanged, rulesChanged, captureRules };
})();
