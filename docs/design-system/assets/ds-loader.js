/* SCND DS loader for specimen cards and the UI kit.
   Prefers the compiled _ds_bundle.js namespace when available; otherwise
   fetches the component .jsx sources and evaluates them with Babel. */
(function () {
  function findNS() {
    var keys = Object.keys(window);
    for (var i = 0; i < keys.length; i++) {
      try {
        var v = window[keys[i]];
        if (v && typeof v === "object" && v.Button && v.Badge) return v;
      } catch (e) {}
    }
    return null;
  }
  function dirname(p) { return p.slice(0, p.lastIndexOf("/")); }
  function resolve(base, rel) {
    if (rel[0] !== ".") return rel;
    var parts = dirname(base).split("/");
    var segs = rel.split("/");
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === ".") continue;
      if (s === "..") parts.pop(); else parts.push(s);
    }
    return parts.join("/");
  }
  var ALL = [
    "components/core/Button.jsx",
    "components/core/Badge.jsx",
    "components/core/Input.jsx",
    "components/core/Select.jsx",
    "components/core/Checkbox.jsx",
    "components/core/Card.jsx",
    "components/core/Table.jsx",
    "components/core/Tabs.jsx",
    "components/core/Dialog.jsx",
    "components/studio/ObjectiveBar.jsx",
    "components/studio/ConstraintChips.jsx",
    "components/studio/MapLegend.jsx",
    "components/studio/SidebarTree.jsx",
    "components/studio/TabBar.jsx",
    "components/studio/StaleOutputBanner.jsx"
  ];
  window.runBabelById = function (id) {
    var code = document.getElementById(id).textContent;
    var out = Babel.transform(code, { presets: [["react", { runtime: "classic" }]] }).code;
    (0, eval)(out);
  };
  window.loadDS = async function (rootPrefix, extra) {
    var ns = extra ? null : findNS();
    if (ns) return ns;
    if (!extra) try {
      var bres = await fetch(rootPrefix + "_ds_bundle.js");
      if (bres.ok) {
        (0, eval)(await bres.text());
        ns = findNS();
        if (ns) return ns;
      }
    } catch (e) {}
    var cache = {};
    async function load(path) {
      if (cache[path]) return cache[path];
      var res = await fetch(rootPrefix + path);
      if (!res.ok) throw new Error("fetch failed: " + path);
      var out = Babel.transform(await res.text(), {
        presets: [["env", { modules: "commonjs" }], ["react", { runtime: "classic" }]],
        filename: path
      }).code;
      var module = { exports: {} };
      var requireFn = function (spec) {
        if (spec === "react") return window.React;
        if (spec === "react-dom") return window.ReactDOM;
        var r = resolve(path, spec);
        if (!cache[r]) throw new Error("module not preloaded: " + r);
        return cache[r];
      };
      new Function("require", "module", "exports", out)(requireFn, module, module.exports);
      cache[path] = module.exports;
      return module.exports;
    }
    ns = {};
    var list = ALL.concat(extra || []);
    for (var i = 0; i < list.length; i++) Object.assign(ns, await load(list[i]));
    window.SCND = ns;
    return ns;
  };
})();
