(function () {
  var $ = function (id) { return document.getElementById(id); };
  function say(m) { var s = $("status"); if (s) s.textContent = m; }
  function el(t, a) {
    var e = document.createElement(t);
    for (var k in (a || {})) { if (k === "text") e.textContent = a[k]; else e.setAttribute(k, a[k]); }
    for (var i = 2; i < arguments.length; i++) e.append(arguments[i]);
    return e;
  }
  function api(path, method, body) {
    method = method || "GET";
    var o = { method: method, credentials: "same-origin", headers: {} };
    if (method !== "GET") { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body || {}); }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "Something went wrong (" + r.status + ")");
        return d;
      });
    });
  }
  function fail(e) { say("Error: " + e.message); }
  function show(id, on) { var x = $(id); if (x) x.hidden = !on; }
  function getSession() { return api("/api/session").catch(function () { return { loggedIn: false }; }); }

  // Nav label follows login state on every page that has the Account link
  var navLink = document.querySelector('nav a[href="account.html"]');
  if (navLink) getSession().then(function (s) { if (s.loggedIn) navLink.textContent = "Your account"; });

  // Shared bits
  function bookmarkLabel(btn, c) {
    btn.textContent = c.saved ? "Remove bookmark" : "Bookmark";
    btn.setAttribute("aria-label", (c.saved ? "Remove bookmark from " : "Bookmark ") + c.title);
  }
  function toggleBookmark(c, btn, after) {
    var on = !c.saved;
    api("/api/bookmarks/" + c.id, on ? "PUT" : "DELETE").then(function () {
      c.saved = on; bookmarkLabel(btn, c);
      say(on ? "Bookmarked " + c.title + "." : "Removed bookmark from " + c.title + ".");
      if (after) after();
    }).catch(fail);
  }
  function card(c, opts) {
    opts = opts || {};
    var li = el("li", {}, el("h3", { text: c.title }),
      el("p", { text: (c.author || "Unknown author") + ". " + (c.status === "published" ? "Read by " : "Claimed by ") + (c.handle || "anonymous") + "." }));
    if (c.licence_note) li.append(el("p", { text: "Rights: " + c.licence_note }));
    if (c.content_notes) li.append(el("p", { text: "Content notes: " + c.content_notes }));
    if (c.archive_url) li.append(el("p", {}, el("a", { href: c.archive_url, text: "Listen to " + c.title + " on archive.org" })));
    else li.append(el("p", { text: "Not recorded yet." }));
    if (opts.canBookmark) {
      if (c.own) li.append(el("p", { text: "You added this." }));
      else {
        var b = el("button", { type: "button" }); bookmarkLabel(b, c);
        b.addEventListener("click", function () { toggleBookmark(c, b, opts.after); });
        li.append(el("div", { class: "actions" }, b));
      }
    }
    return li;
  }

  // Public list (home page)
  var pub = $("public-list");
  if (pub) Promise.all([api("/api/contributions"), getSession()]).then(function (res) {
    var rows = res[0], s = res[1];
    pub.textContent = "";
    if (!rows.length) { pub.append(el("p", { text: "Nothing here yet. Be the first to contribute." })); return; }
    if (!s.loggedIn) pub.append(el("p", {}, el("a", { href: "account.html", text: "Log in" }), " to bookmark recordings and keep track of your own."));
    var ul = el("ul");
    rows.forEach(function (c) { ul.append(card(c, { canBookmark: !!s.loggedIn })); });
    pub.append(ul);
  }).catch(function () { pub.textContent = "The list couldn't be loaded. You can still browse archive.org directly."; });

  // Account page
  if ($("signed-out")) {
    var editing = null;
    function view(inn) { show("signed-in", inn); show("signed-out", !inn); }
    function refresh() {
      return api("/api/me").then(function (me) {
        $("handle").value = me.handle || "";
        $("welcome").textContent = me.handle ? "Logged in as " + me.handle + "." : "Logged in. You haven't set a display name.";
        view(true); return Promise.all([mine(), bookmarks()]);
      }).catch(function () { view(false); });
    }
    function mine() {
      return api("/api/mine").then(function (rows) {
        var box = $("mine"); box.textContent = "";
        if (!rows.length) { box.append(el("p", { text: "You haven't added anything yet." })); return; }
        var ul = el("ul");
        rows.forEach(function (c) {
          var li = el("li", {}, el("h3", { text: c.title }),
            el("p", { text: (c.status === "published" ? "Published" : "Claimed, not recorded yet") + ". Last updated " + c.updated + "." }));
          if (c.archive_url && !c.removed) li.append(el("p", {}, el("a", { href: c.archive_url, text: "Open " + c.title + " on archive.org" })));
          var acts = el("div", { class: "actions" });
          if (c.removed) li.append(el("p", { text: "Removed by the admin." + (c.removed_reason ? " Reason: " + c.removed_reason : "") }));
          else {
            var eb = el("button", { type: "button", text: "Edit", "aria-label": "Edit " + c.title });
            eb.addEventListener("click", function () { edit(c); }); acts.append(eb);
          }
          var del = el("button", { type: "button", text: "Delete", "aria-label": "Delete " + c.title });
          del.addEventListener("click", function () {
            if (!confirm("Delete \"" + c.title + "\"? This can't be undone.")) return;
            api("/api/contributions/" + c.id, "DELETE").then(function () { say("Deleted."); return mine(); }).catch(fail);
          });
          acts.append(del); li.append(acts); ul.append(li);
        });
        box.append(ul);
      }).catch(fail);
    }
    function bookmarks() {
      return api("/api/bookmarks").then(function (rows) {
        var box = $("bookmarks"); box.textContent = "";
        if (!rows.length) { box.append(el("p", {}, "You haven't bookmarked anything yet. Find recordings on the ", el("a", { href: "/#listen", text: "Listen page" }), ".")); return; }
        var ul = el("ul");
        rows.forEach(function (c) { c.saved = true; ul.append(card(c, { canBookmark: true, after: bookmarks })); });
        box.append(ul);
      }).catch(fail);
    }
    function edit(c) {
      editing = c ? c.id : null;
      $("form-h").textContent = c ? "Edit contribution" : "Add a contribution";
      var f = $("cform");
      f.elements.title.value = c ? c.title : ""; f.elements.author.value = c ? c.author : ""; f.elements.status.value = c ? c.status : "claimed";
      f.elements.archive_url.value = c ? c.archive_url : ""; f.elements.licence_note.value = c ? c.licence_note : ""; f.elements.content_notes.value = c ? c.content_notes : "";
      show("cancel", !!c);
      if (c) { f.scrollIntoView(); f.elements.title.focus(); }
    }
    $("signup").addEventListener("submit", function (e) {
      e.preventDefault();
      api("/api/signup", "POST", { handle: $("newhandle").value }).then(function (d) {
        $("keyval").value = d.key; show("signed-out", false); show("keypanel", true); $("key-h").focus();
      }).catch(fail);
    });
    $("savekey").addEventListener("click", function () {
      var a = el("a", { href: URL.createObjectURL(new Blob(["Unowned Audio account key:\n" + $("keyval").value + "\n"], { type: "text/plain" })), download: "unowned-audio-key.txt" });
      document.body.append(a); a.click(); a.remove();
    });
    $("keydone").addEventListener("click", function () { show("keypanel", false); refresh().then(function () { say("You're logged in."); $("main-h").focus(); }); });
    $("login").addEventListener("submit", function (e) {
      e.preventDefault();
      api("/api/login", "POST", { key: $("key").value }).then(function () { $("key").value = ""; return refresh(); }).then(function () { say("You're logged in."); }).catch(fail);
    });
    $("cform").addEventListener("submit", function (e) {
      e.preventDefault(); var f = e.target;
      var b = { title: f.elements.title.value, author: f.elements.author.value, status: f.elements.status.value, archive_url: f.elements.archive_url.value, licence_note: f.elements.licence_note.value, content_notes: f.elements.content_notes.value };
      (editing ? api("/api/contributions/" + editing, "PUT", b) : api("/api/contributions", "POST", b))
        .then(function () { say("Saved."); edit(null); return mine(); }).catch(fail);
    });
    $("cancel").addEventListener("click", function () { edit(null); say("Edit cancelled."); });
    $("hform").addEventListener("submit", function (e) { e.preventDefault(); api("/api/me", "POST", { handle: $("handle").value }).then(function () { say("Name saved."); return refresh(); }).catch(fail); });
    $("logout").addEventListener("click", function () { api("/api/logout", "POST").then(function () { view(false); say("You're logged out."); }); });
    $("delacct").addEventListener("click", function () {
      if (!confirm("Delete your account and everything you added? This can't be undone.")) return;
      api("/api/me", "DELETE").then(function () { view(false); say("Your account and contributions are deleted."); }).catch(fail);
    });
    edit(null); refresh();
  }

  // Admin page
  if ($("admin-login")) {
    var all = [];
    function render() {
      var f = $("filter").value, tb = $("rows"); tb.textContent = "";
      var rows = all.filter(function (c) { return f === "all" || (f === "removed") === !!c.removed; });
      $("count").textContent = "Showing " + rows.length + " of " + all.length + ".";
      rows.forEach(function (c) {
        var tr = el("tr", {},
          el("th", { scope: "row" }, el("span", { text: c.title }),
            c.archive_url ? el("div", {}, el("a", { href: c.archive_url, text: "Open on archive.org", rel: "noopener noreferrer" })) : ""),
          el("td", { text: c.handle || "anonymous" }), el("td", { text: c.status }),
          el("td", { text: c.removed ? "Removed" + (c.removed_reason ? ": " + c.removed_reason : "") : "Visible" }));
        var rb = el("button", { type: "button", text: c.removed ? "Restore" : "Remove", "aria-label": (c.removed ? "Restore " : "Remove ") + c.title });
        rb.addEventListener("click", function () {
          api("/api/admin/contributions/" + c.id + "/" + (c.removed ? "restore" : "remove"), "POST", { reason: $("reason").value })
            .then(function () { $("reason").value = ""; return load().then(function () { say((c.removed ? "Restored " : "Removed ") + c.title + "."); }); }).catch(fail);
        });
        var db = el("button", { type: "button", text: "Delete permanently", "aria-label": "Delete " + c.title + " permanently" });
        db.addEventListener("click", function () {
          if (!confirm("Permanently delete \"" + c.title + "\"? It disappears for everyone, including the contributor, and can't be restored.")) return;
          api("/api/admin/contributions/" + c.id, "DELETE").then(function () { return load().then(function () { say("Deleted " + c.title + "."); }); }).catch(fail);
        });
        tr.append(el("td", {}, el("div", { class: "actions" }, rb, db))); tb.append(tr);
      });
    }
    function load() {
      return api("/api/admin/contributions").then(function (rows) {
        all = rows; show("admin-login", false); show("admin-panel", true); render();
        if (!rows.length) say("No contributions yet.");
      });
    }
    $("filter").addEventListener("change", render);
    $("admin-login").addEventListener("submit", function (e) {
      e.preventDefault();
      api("/api/admin/login", "POST", { secret: $("secret").value }).then(function () { $("secret").value = ""; return load(); }).then(function () { say("Logged in."); }).catch(fail);
    });
    $("admin-logout").addEventListener("click", function () { api("/api/logout", "POST").then(function () { show("admin-panel", false); show("admin-login", true); say("Logged out."); }); });
    load().catch(function () {});
  }
})();
