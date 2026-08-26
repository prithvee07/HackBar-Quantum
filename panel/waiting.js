
    /****************************/
    /* SAVING / UPDATING FIELDS */
    /****************************/

    var myWindowId = null; // Current window id, set once browser.windows.getCurrent() resolves
    var ready = false;     // Guards tabs.onUpdated/onActivated/mouseout firing before myWindowId is known

    var MAX_SAVED_ENTRIES = 200;     // Cap on distinct saved URLs, to bound storage.local growth
    var LRU_KEY = "__hackbarLru__";  // Reserved key tracking least-recently-used order

    // storage.session (Firefox 115+) is cleared when the browser closes; fall back to
    // storage.local on older Firefox where storage.session doesn't exist.
    var sessionStore = browser.storage.session || browser.storage.local;

    // Key by origin+pathname rather than the full URL, so fuzzing a query-string value
    // (e.g. via the Replace stepper) doesn't create a new storage entry per value tried.
    function storageKeyFor(url) {
        try {
            var u = new URL(url);
            return u.origin + u.pathname;
        } catch (e) {
            return url; // fall back to the raw string for non-standard URLs (about:, etc.)
        }
    }

    // Move `key` to the end of the LRU order (most-recently-used) and evict the oldest
    // entries from both local and session storage once MAX_SAVED_ENTRIES is exceeded.
    function touchLru(key) {
        return browser.storage.local.get(LRU_KEY).then((stored) => {
            var order = (stored[LRU_KEY] || []).filter((k) => k !== key);
            order.push(key);

            var evicted = [];
            while (order.length > MAX_SAVED_ENTRIES) {
                evicted.push(order.shift());
            }

            var toSet = {};
            toSet[LRU_KEY] = order;
            return browser.storage.local.set(toSet).then(() => {
                if (evicted.length === 0) return;
                return Promise.all([
                    browser.storage.local.remove(evicted),
                    sessionStore.remove(evicted)
                ]);
            });
        });
    }

    // When the user mouses out, save the current field values keyed by the tab's
    // origin+pathname. GET/POST data goes to storage.local (persists across restarts);
    // Cookies/Referrer - the fields most likely to carry live session secrets - go to
    // storage.session so they're cleared when the browser closes instead of sitting on
    // disk indefinitely.
    window.addEventListener("mouseout", () => {
        if (!ready) return;
        browser.tabs.query({ windowId: myWindowId, active: true }).then((tabs) => {
            if (!tabs[0]) return;
            var key = storageKeyFor(tabs[0].url);

            var localData = {};
            localData[key] = { get: $("#GETAREA").val(), post: $("#POSTDATA").val() };

            var sessionData = {};
            sessionData[key] = { cookies: $("#COOKIES").val(), referer: $("#REFERER").val() };

            return Promise.all([
                browser.storage.local.set(localData),
                sessionStore.set(sessionData),
                touchLru(key)
            ]);
        }).catch((err) => console.error("Hackbar: failed to save field data", err));
    });




    // Update the Hackbar content for the active tab
    function updateContent() {
        if (!ready) return;
        var key;
        browser.tabs.query({ windowId: myWindowId, active: true })
            .then((tabs) => {
                if (!tabs[0]) return null;
                key = storageKeyFor(tabs[0].url);
                return Promise.all([
                    browser.storage.local.get(key),
                    sessionStore.get(key)
                ]);
            })
            .then((results) => {
                if (!results) return;
                var localInfo = results[0][key] || {};
                var sessionInfo = results[1][key] || {};
                $("#GETAREA").val(localInfo.get || "");
                $("#POSTDATA").val(localInfo.post || "");
                $("#COOKIES").val(sessionInfo.cookies || "");
                $("#REFERER").val(sessionInfo.referer || "");
            })
            .catch((err) => console.error("Hackbar: failed to restore field data", err));
    }

    // "Clear Saved Data": wipe all Hackbar-saved field data, across every URL
    $(function () {
        $("#clearSavedData").click(function () {
            Promise.all([
                browser.storage.local.clear(),
                sessionStore.clear()
            ]).then(() => {
                updateContent();
            }).catch((err) => console.error("Hackbar: failed to clear saved data", err));
        });
    });




    // Update Content when updating the tab (i.e. new page)
    browser.tabs.onUpdated.addListener(updateContent);

    // Update Content when activating the tab
    browser.tabs.onActivated.addListener(updateContent);

    // On Start, setting current window and updating hackbar
    browser.windows.getCurrent({ populate: true }).then((windowInfo) => {
        myWindowId = windowInfo.id;
        ready = true;
        updateContent();
    }).catch((err) => console.error("Hackbar: failed to determine current window", err));
