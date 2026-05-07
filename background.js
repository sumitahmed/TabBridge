// TabBridge — Background Service Worker
// Manifest V3 requires a service worker. This file handles
// any background tasks. Currently minimal — the heavy lifting
// happens in popup.js.

chrome.runtime.onInstalled.addListener(() => {
  console.log("TabBridge installed successfully.");
});
