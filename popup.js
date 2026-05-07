// ════════════════════════════════════════════════
//  TabBridge — popup.js
//  Export / Import tab groups 
// ════════════════════════════════════════════════

"use strict";

// ─── DOM References ─────────────────────────────
const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const dom = {
  // Tab nav
  tabBtns:       $$(".tab-btn"),
  panelExport:   $("#panel-export"),
  panelImport:   $("#panel-import"),

  // Export
  btnExport:     $("#btn-export"),
  exportPreview: $("#export-preview"),
  exportJson:    $("#export-json"),
  exportCount:   $("#export-count"),
  btnDownload:   $("#btn-download"),
  btnCopy:       $("#btn-copy"),

  // Import
  importJson:    $("#import-json"),
  btnImport:     $("#btn-import"),
  fileInput:     $("#file-input"),

  // Feedback
  toast:         $("#toast"),
  loading:       $("#loading"),
};

// Store last exported data so download/copy buttons work
let lastExportData = null;


// ═════════════════════════════════════════════════
//  TAB NAVIGATION
// ═════════════════════════════════════════════════

dom.tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    // toggle active class on buttons
    dom.tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // toggle panels
    const target = btn.dataset.tab;
    dom.panelExport.classList.toggle("active", target === "export");
    dom.panelImport.classList.toggle("active", target === "import");
  });
});


// ═════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═════════════════════════════════════════════════

let toastTimer = null;

/**
 * Show a toast message.
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 * @param {number} duration  ms
 */
function showToast(message, type = "info", duration = 2500) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = "toast " + type;

  // trigger reflow so re-triggering the same toast works
  void dom.toast.offsetWidth;
  dom.toast.classList.add("show");

  toastTimer = setTimeout(() => {
    dom.toast.classList.remove("show");
  }, duration);
}


// ═════════════════════════════════════════════════
//  LOADING OVERLAY
// ═════════════════════════════════════════════════

function showLoading(text = "Working…") {
  dom.loading.querySelector(".loading-text").textContent = text;
  dom.loading.classList.remove("hidden");
}

function hideLoading() {
  dom.loading.classList.add("hidden");
}


// ═════════════════════════════════════════════════
//  EXPORT FEATURE
// ═════════════════════════════════════════════════

/**
 * URLs we can't recreate — skip them.
 */
function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-search://")
  );
}

/**
 * Read all tab groups and their tabs, produce a clean JSON structure.
 */
async function exportTabGroups() {
  // 1. Get all tabs in the current window
  const tabs = await chrome.tabs.query({ currentWindow: true });

  // 2. Get all tab groups in the current window
  let groups = [];
  try {
    groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  } catch (e) {
    // tabGroups API might not exist on older browsers
    console.warn("tabGroups.query failed:", e);
  }

  // 3. Build a map of groupId -> group info
  const groupMap = new Map();
  for (const g of groups) {
    groupMap.set(g.id, {
      title: g.title || "Untitled",
      color: g.color || "grey",
      collapsed: g.collapsed || false,
      tabs: [],
    });
  }

  // 4. Also collect ungrouped tabs
  const ungroupedTabs = [];

  // 5. Sort tabs into their groups
  for (const tab of tabs) {
    if (isRestrictedUrl(tab.url)) continue;

    const entry = {
      title: tab.title || tab.url,
      url: tab.url,
    };

    if (tab.groupId && tab.groupId !== -1 && groupMap.has(tab.groupId)) {
      groupMap.get(tab.groupId).tabs.push(entry);
    } else {
      ungroupedTabs.push(entry);
    }
  }

  // 6. Build final payload
  const payload = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    browser: navigator.userAgent.includes("Brave") ? "Brave"
           : navigator.userAgent.includes("Edg")   ? "Edge"
           : "Chrome",
    groups: [],
  };

  // Add grouped tabs
  for (const [, group] of groupMap) {
    if (group.tabs.length > 0) {
      payload.groups.push({
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        tabs: group.tabs,
      });
    }
  }

  // Add ungrouped tabs as a special group
  if (ungroupedTabs.length > 0) {
    payload.groups.push({
      title: "Ungrouped",
      color: "grey",
      collapsed: false,
      tabs: ungroupedTabs,
    });
  }

  return payload;
}


dom.btnExport.addEventListener("click", async () => {
  try {
    dom.btnExport.disabled = true;
    showLoading("Scanning tab groups…");

    const data = await exportTabGroups();
    lastExportData = data;

    // Count total tabs
    const totalTabs = data.groups.reduce((sum, g) => sum + g.tabs.length, 0);

    // Update preview
    dom.exportJson.textContent = JSON.stringify(data, null, 2);
    dom.exportCount.textContent = `${data.groups.length} groups · ${totalTabs} tabs`;
    dom.exportPreview.classList.remove("hidden");

    hideLoading();
    showToast(`Exported ${data.groups.length} groups (${totalTabs} tabs)`, "success");
  } catch (err) {
    hideLoading();
    console.error("Export failed:", err);
    showToast("Export failed — " + err.message, "error");
  } finally {
    dom.btnExport.disabled = false;
  }
});


// ─── Download JSON ──────────────────────────────

dom.btnDownload.addEventListener("click", () => {
  if (!lastExportData) return;

  const blob = new Blob([JSON.stringify(lastExportData, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);

  // Use chrome.downloads if available, otherwise fallback
  try {
    chrome.downloads.download({
      url: url,
      filename: `tabbridge-export-${dateStamp()}.json`,
      saveAs: true,
    });
    showToast("Downloading…", "info");
  } catch {
    // Fallback: create a link and click it
    const a = document.createElement("a");
    a.href = url;
    a.download = `tabbridge-export-${dateStamp()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Download started", "info");
  }
});

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


// ─── Copy JSON ──────────────────────────────────

dom.btnCopy.addEventListener("click", async () => {
  if (!lastExportData) return;

  try {
    await navigator.clipboard.writeText(JSON.stringify(lastExportData, null, 2));
    showToast("Copied to clipboard!", "success");
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = JSON.stringify(lastExportData, null, 2);
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("Copied to clipboard!", "success");
  }
});


// ═════════════════════════════════════════════════
//  IMPORT FEATURE
// ═════════════════════════════════════════════════

/**
 * Validate the import payload structure.
 */
function validatePayload(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid JSON: not an object.");
  }
  if (!Array.isArray(data.groups)) {
    throw new Error('Invalid format: missing "groups" array.');
  }
  for (let i = 0; i < data.groups.length; i++) {
    const g = data.groups[i];
    if (!g.title || !Array.isArray(g.tabs)) {
      throw new Error(`Group ${i + 1} is missing title or tabs.`);
    }
    for (let j = 0; j < g.tabs.length; j++) {
      if (!g.tabs[j].url) {
        throw new Error(`Group "${g.title}", tab ${j + 1}: missing URL.`);
      }
    }
  }
}

/**
 * Valid colors the chrome.tabGroups API accepts.
 */
const VALID_COLORS = new Set([
  "grey", "blue", "red", "yellow", "green",
  "pink", "purple", "cyan", "orange",
]);

function sanitizeColor(color) {
  return VALID_COLORS.has(color) ? color : "grey";
}

/**
 * Import tab groups from parsed JSON.
 */
async function importTabGroups(data) {
  validatePayload(data);

  let totalCreated = 0;
  let groupsCreated = 0;

  for (const group of data.groups) {
    if (!group.tabs || group.tabs.length === 0) continue;

    // 1. Create all tabs in this group concurrently and collect their IDs
    const tabPromises = group.tabs
      .filter((t) => t.url && !isRestrictedUrl(t.url))
      .map((t) =>
        chrome.tabs.create({ url: t.url, active: false })
      );

    const createdTabs = await Promise.all(tabPromises);
    const tabIds = createdTabs.map((t) => t.id);
    totalCreated += tabIds.length;

    if (tabIds.length === 0) continue;

    // 2. Group the tabs
    const groupId = await chrome.tabs.group({ tabIds });

    // 3. Update the group with name and color
    await chrome.tabGroups.update(groupId, {
      title: group.title || "Untitled",
      color: sanitizeColor(group.color),
      collapsed: group.collapsed || false,
    });

    groupsCreated++;
  }

  return { groupsCreated, totalCreated };
}


dom.btnImport.addEventListener("click", async () => {
  const raw = dom.importJson.value.trim();
  if (!raw) {
    showToast("Paste some JSON first!", "error");
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    showToast("Invalid JSON — check your paste.", "error");
    return;
  }

  try {
    dom.btnImport.disabled = true;
    showLoading("Recreating tab groups…");

    const result = await importTabGroups(data);

    hideLoading();
    dom.importJson.value = "";
    showToast(
      `Imported ${result.groupsCreated} groups (${result.totalCreated} tabs)`,
      "success",
      3500
    );
  } catch (err) {
    hideLoading();
    console.error("Import failed:", err);
    showToast("Import failed — " + err.message, "error", 4000);
  } finally {
    dom.btnImport.disabled = false;
  }
});


// ─── Import from File ───────────────────────────

dom.fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    dom.importJson.value = reader.result;
    showToast("File loaded — click Import", "info");
  };
  reader.onerror = () => {
    showToast("Could not read file.", "error");
  };
  reader.readAsText(file);

  // Reset so the same file can be selected again
  e.target.value = "";
});
