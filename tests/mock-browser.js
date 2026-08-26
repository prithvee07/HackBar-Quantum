// Minimal in-page mock of the WebExtension browser.* namespace, used only by the
// Chromium-based e2e harness in tests/e2e.js (Chromium has no `browser` global at
// all - only Firefox does - so panel.js/waiting.js can't run without this).
// It does NOT reproduce real WebExtension runtime behavior: permission prompts,
// webRequest's actual network-layer header interception, and CORS bypass via host
// permissions are all genuine browser/extension privileges no page-level JS shim
// can fake. See tests/README.md for exactly what this harness does and doesn't prove.
(function () {
  var storageLocalData = {};
  var storageSessionData = {};

  function storageApi(store, label) {
    return {
      get: function (key) {
        if (key == null) return Promise.resolve(Object.assign({}, store));
        if (typeof key === 'string') {
          var r = {};
          if (Object.prototype.hasOwnProperty.call(store, key)) r[key] = store[key];
          return Promise.resolve(r);
        }
        var r2 = {};
        key.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(store, k)) r2[k] = store[k]; });
        return Promise.resolve(r2);
      },
      set: function (obj) {
        Object.keys(obj).forEach(function (k) { store[k] = obj[k]; });
        window.__mockEvents.push({ type: 'storage.set', store: label, data: JSON.parse(JSON.stringify(obj)) });
        return Promise.resolve();
      },
      remove: function (keys) {
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { delete store[k]; });
        window.__mockEvents.push({ type: 'storage.remove', store: label, keys: keys });
        return Promise.resolve();
      },
      clear: function () {
        Object.keys(store).forEach(function (k) { delete store[k]; });
        window.__mockEvents.push({ type: 'storage.clear', store: label });
        return Promise.resolve();
      }
    };
  }

  window.__mockEvents = [];
  window.__mockTabUrl = 'https://victim.example.com/app/page?userid=42';
  window.__mockPermissionGranted = true;
  window.__mockPermissionRequests = [];
  window.__storageLocal = storageLocalData;
  window.__storageSession = storageSessionData;
  window.__tabsUpdatedListeners = [];
  window.__tabsActivatedListeners = [];
  window.__simulateTabChange = function (newUrl) {
    if (newUrl) window.__mockTabUrl = newUrl;
    window.__tabsUpdatedListeners.forEach(function (cb) { cb(1, {}, {}); });
  };

  window.browser = {
    runtime: {
      connect: function () {
        return { postMessage: function () {}, onMessage: { addListener: function () {} } };
      }
    },
    storage: {
      local: storageApi(storageLocalData, 'local'),
      session: storageApi(storageSessionData, 'session')
    },
    tabs: {
      query: function () { return Promise.resolve([{ url: window.__mockTabUrl, id: 1 }]); },
      onUpdated: { addListener: function (cb) { window.__tabsUpdatedListeners.push(cb); } },
      onActivated: { addListener: function (cb) { window.__tabsActivatedListeners.push(cb); } }
    },
    windows: {
      getCurrent: function () { return Promise.resolve({ id: 1 }); }
    },
    permissions: {
      contains: function () { return Promise.resolve(window.__mockPermissionGranted); },
      request: function (perms) {
        window.__mockPermissionRequests.push(perms);
        return Promise.resolve(window.__mockPermissionGranted);
      }
    },
    webRequest: {
      onBeforeSendHeaders: {
        addListener: function (listener, filter, spec) {
          window.__mockEvents.push({ type: 'webRequest.addListener', filter: filter, spec: spec });
        },
        removeListener: function () {
          window.__mockEvents.push({ type: 'webRequest.removeListener' });
        }
      }
    }
  };
})();
