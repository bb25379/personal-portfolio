/* ============================================================
 *  store.js — 資料存取層，兩種後端共用同一組介面
 *
 *    CFG.MODE === 'github'  → 用 GitHub Contents API，把 repo 當資料庫（正式版）
 *    CFG.MODE === 'demo'    → 只寫瀏覽器的 localStorage，不需要任何權杖（公開展示版）
 *
 *  介面只有四個：readJson / writeJson / upsertJson / listDir
 *  頁面完全不需要知道現在跑的是哪一種。
 * ========================================================== */

(function () {
  'use strict';

  var CFG = window.CFG;
  var MODE = (CFG && CFG.MODE) || 'github';
  var API = (CFG && CFG.API_BASE) || 'https://api.github.com';

  function StoreError(code, message, status) {
    var e = new Error(message);
    e.code = code;
    e.status = status;
    return e;
  }

  /* ---- UTF-8 <-> base64（GitHub 模式用，也給頁面備用） ---- */
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ==========================================================
   *  後端一：GitHub Contents API
   * ======================================================== */
  var gh = (function () {
    function base() {
      return API + '/repos/' + CFG.OWNER + '/' + CFG.REPO + '/contents/';
    }
    function headers() {
      return {
        'Authorization': 'Bearer ' + CFG.TOKEN,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      };
    }
    function explain(status, body) {
      if (status === 401) return StoreError('bad_token', '權杖無效或已過期，請在 assets/config.js 更新 TOKEN。', status);
      if (status === 403) return StoreError('forbidden', '權杖沒有這個 repo 的 Contents 寫入權限，或已達 API 速率上限。', status);
      if (status === 404) return StoreError('not_found', '找不到資料（repo、分支或路徑不存在）。', status);
      if (status === 409 || status === 422) return StoreError('conflict', '有人同時改了同一筆資料，請重新載入後再試。', status);
      return StoreError('http_' + status, '連線失敗（HTTP ' + status + '）' + (body ? '：' + body.slice(0, 160) : ''), status);
    }

    return {
      readJson: function (path) {
        return fetch(base() + encodeURI(path) + '?ref=' + encodeURIComponent(CFG.BRANCH) + '&t=' + Date.now(),
          { headers: headers(), cache: 'no-store' })
          .then(function (r) {
            if (r.status === 404) return null;
            if (!r.ok) return r.text().then(function (t) { throw explain(r.status, t); });
            return r.json().then(function (j) {
              return { data: JSON.parse(b64decode(j.content)), sha: j.sha, path: path };
            });
          });
      },
      writeJson: function (path, obj, message, sha) {
        var body = {
          message: message || ('update ' + path),
          content: b64encode(JSON.stringify(obj, null, 2) + '\n'),
          branch: CFG.BRANCH
        };
        if (sha) body.sha = sha;
        return fetch(base() + encodeURI(path), {
          method: 'PUT', headers: headers(), body: JSON.stringify(body)
        }).then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw explain(r.status, t); });
          return r.json().then(function (j) { return { sha: j.content && j.content.sha }; });
        });
      },
      listDir: function (path) {
        return fetch(base() + encodeURI(path) + '?ref=' + encodeURIComponent(CFG.BRANCH) + '&t=' + Date.now(),
          { headers: headers(), cache: 'no-store' })
          .then(function (r) {
            if (r.status === 404) return [];
            if (!r.ok) return r.text().then(function (t) { throw explain(r.status, t); });
            return r.json().then(function (j) { return Array.isArray(j) ? j : []; });
          });
      },
      configured: function () {
        return !!(CFG && CFG.TOKEN && CFG.TOKEN.indexOf('PUT_YOURS_HERE') < 0
          && CFG.OWNER && CFG.OWNER.indexOf('YOUR-GITHUB') < 0);
      }
    };
  })();

  /* ==========================================================
   *  後端二：localStorage（demo）
   *  ── 資料只留在這台瀏覽器，換裝置、換瀏覽器、無痕視窗都看不到彼此。
   *     這正是 demo 想要的：訪客可以隨便玩，碰不到任何真實資料。
   * ======================================================== */
  var local = (function () {
    var NS = 'mv.demo:';
    var IDX = 'mv.demo.index';

    function ok(v) { return Promise.resolve(v); }
    function fail(e) { return Promise.reject(e); }

    function paths() {
      try { return JSON.parse(localStorage.getItem(IDX) || '[]'); } catch (e) { return []; }
    }
    function savePaths(list) {
      try { localStorage.setItem(IDX, JSON.stringify(list)); } catch (e) { /* 滿了就算了 */ }
    }
    function hash(s) {
      var h = 0;
      for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
      return 'l' + (h >>> 0).toString(16);
    }

    function read(path) {
      var raw;
      try { raw = localStorage.getItem(NS + path); } catch (e) { raw = null; }
      if (raw === null) return null;
      try { return { data: JSON.parse(raw), sha: hash(raw), path: path }; }
      catch (e) { return null; }
    }

    return {
      readJson: function (path) { return ok(read(path)); },

      writeJson: function (path, obj, message, sha) {
        var cur = read(path);
        if (cur && sha && cur.sha !== sha) {
          return fail(StoreError('conflict', '這筆資料在別的分頁被改過了，請重新載入。'));
        }
        var raw = JSON.stringify(obj, null, 2);
        try { localStorage.setItem(NS + path, raw); }
        catch (e) {
          return fail(StoreError('too_large', '瀏覽器儲存空間不足，請按 demo 橫幅的「重設範例資料」清一次。'));
        }
        var list = paths();
        if (list.indexOf(path) < 0) { list.push(path); savePaths(list); }
        return ok({ sha: hash(raw) });
      },

      listDir: function (dir) {
        var prefix = dir.replace(/\/+$/, '') + '/';
        var seen = Object.create(null), out = [];
        paths().forEach(function (p) {
          if (p.indexOf(prefix) !== 0) return;
          var rest = p.slice(prefix.length);
          var slash = rest.indexOf('/');
          var name = slash < 0 ? rest : rest.slice(0, slash);
          if (seen[name]) return;
          seen[name] = 1;
          out.push({ name: name, path: prefix + name, type: slash < 0 ? 'file' : 'dir' });
        });
        return ok(out);
      },

      configured: function () { return true; },

      /* demo 專用 */
      reset: function () {
        paths().forEach(function (p) {
          try { localStorage.removeItem(NS + p); } catch (e) { /* ignore */ }
        });
        savePaths([]);
        try { localStorage.removeItem('mv.mine'); localStorage.removeItem('mv.me'); } catch (e) { /* ignore */ }
      },
      isEmpty: function () { return paths().length === 0; }
    };
  })();

  var impl = MODE === 'demo' ? local : gh;

  /* 讀了再寫，自動帶上 sha（兩種後端共用） */
  function upsertJson(path, mutate, message) {
    return impl.readJson(path).then(function (cur) {
      var next = mutate(cur ? cur.data : null);
      return impl.writeJson(path, next, message, cur ? cur.sha : null).then(function () { return next; });
    });
  }

  window.Store = {
    mode: MODE,
    isDemo: MODE === 'demo',
    readJson: impl.readJson,
    writeJson: impl.writeJson,
    listDir: impl.listDir,
    upsertJson: upsertJson,
    configured: impl.configured,
    b64encode: b64encode,
    b64decode: b64decode,
    /* demo 專用，正式模式下是 no-op */
    resetDemo: MODE === 'demo' ? local.reset : function () {},
    demoIsEmpty: MODE === 'demo' ? local.isEmpty : function () { return false; }
  };
})();
