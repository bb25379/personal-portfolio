/* ============================================================
 *  core.js — 共用邏輯：亂數代碼、時段運算、交集統計、日曆連結、格狀選擇表
 * ========================================================== */

(function () {
  'use strict';

  var CFG = window.CFG;
  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  var CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  /* ---------------- 基本工具 ---------------- */
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function hm(t) { return p2(Math.floor(t / 60)) + ':' + p2(t % 60); }
  function toMin(s) { var a = String(s || '').split(':'); return (+a[0] || 0) * 60 + (+a[1] || 0); }
  function key(d, t) { return d + ' ' + hm(t); }
  function md(d) { return String(d).slice(5).replace('-', '/'); }
  function isoDay(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function wdOf(s) { var a = String(s).split('-'); return WD[new Date(a[0], a[1] - 1, a[2]).getDay()]; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rand(n, chars) {
    var out = '', buf = new Uint32Array(n);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < n; i++) out += chars.charAt(buf[i] % chars.length);
    return out;
  }
  function newCode() { return rand(32, CODE_CHARS); }
  function newPin() { return rand(6, '0123456789'); }
  function newId() { return 'p' + rand(8, 'abcdefghijkmnpqrstuvwxyz23456789'); }

  /* 代碼只允許 A–Z a–z 0–9，避免有人用 ../ 之類的路徑跑出去 */
  function validCode(c) { return typeof c === 'string' && /^[A-Za-z0-9]{8,64}$/.test(c); }

  function pollDir(code) { return CFG.ROOT + '/' + code; }
  function meetingPath(code) { return pollDir(code) + '/meeting.json'; }
  function responsePath(code, pid) { return pollDir(code) + '/responses/' + pid + '.json'; }
  function indexPath() { return CFG.ROOT + '/index.json'; }

  /* ---------------- 時間 ---------------- */
  function deadlineMs(m) {
    if (!m || !m.deadline) return null;
    var d = new Date(m.deadline + ':00' + CFG.TZ_OFFSET);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  function fmtDeadline(m) {
    var raw = m && m.deadline;
    if (!raw) return '未設定';
    var g = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return g ? g[1] + '/' + g[2] + '/' + g[3] + ' ' + g[4] + ':' + g[5] : String(raw);
  }
  function isShut(m) {
    if (!m) return true;
    if (m.closed) return true;
    var dm = deadlineMs(m);
    return dm !== null && dm < Date.now();
  }

  /* ---------------- 時段骨架 ---------------- */
  function slots(m) {
    var out = [], t;
    for (t = m.startMin; t + m.stepMin <= m.endMin; t += m.stepMin) {
      if (m.brkOn && t < m.brkEnd && t + m.stepMin > m.brkStart) continue;
      out.push(t);
    }
    return { dates: (m.dates || []).slice(), times: out, step: m.stepMin };
  }

  /* 主辦人在建立時關掉的格子（不列為候選時段） */
  function offSet(m) {
    var s = Object.create(null);
    (m && m.off ? m.off : []).forEach(function (k) { s[k] = 1; });
    return s;
  }
  function isOff(off, k) { return !!off[k]; }

  /* ---------------- 交集統計 ----------------
   * responses: [{pid, name, slots:{key:1|2}}]
   * 回傳 { g, heat, blocks, done[], pending[] }
   * blocks 已排序：可以人數多者優先，其次勉強人數
   */
  function tally(m, responses) {
    var g = slots(m);
    var byPid = {};
    (responses || []).forEach(function (r) { if (r && r.pid) byPid[r.pid] = r.slots || {}; });

    var people = m.people || [];
    var done = people.filter(function (p) { return byPid[p.id]; });
    var pending = people.filter(function (p) { return !byPid[p.id]; });
    var doneIds = done.map(function (p) { return p.id; });

    var off = offSet(m);
    var heat = {};
    g.dates.forEach(function (d) {
      g.times.forEach(function (t) {
        var k = key(d, t);
        if (off[k]) { heat[k] = null; return; }
        var yi = [], mi = [], ni = [];
        doneIds.forEach(function (id) {
          var v = +(byPid[id][k] || 0);
          if (v === 2) yi.push(id); else if (v === 1) mi.push(id); else ni.push(id);
        });
        heat[k] = { y: yi.length, m: mi.length, n: ni.length, yi: yi, mi: mi, ni: ni };
      });
    });

    var need = Math.max(1, Math.ceil((m.lengthMin || g.step) / g.step));
    var blocks = [];
    g.dates.forEach(function (d) {
      for (var i = 0; i + need <= g.times.length; i++) {
        var contiguous = true;
        for (var k1 = 0; k1 < need; k1++) {
          if (k1 > 0 && g.times[i + k1] !== g.times[i] + k1 * g.step) { contiguous = false; break; }
          if (off[key(d, g.times[i + k1])]) { contiguous = false; break; }
        }
        if (!contiguous) continue;

        var yes = [], mby = [], no = [];
        doneIds.forEach(function (id) {
          var worst = 2;
          for (var k2 = 0; k2 < need; k2++) {
            var v = +(byPid[id][key(d, g.times[i + k2])] || 0);
            if (v < worst) worst = v;
          }
          if (worst === 2) yes.push(id); else if (worst === 1) mby.push(id); else no.push(id);
        });

        blocks.push({
          date: d, s: g.times[i], e: g.times[i] + need * g.step,
          yes: yes, mby: mby, no: no,
          all: doneIds.length > 0 && no.length === 0 && mby.length === 0
        });
      }
    });

    blocks.sort(function (a, b) {
      if (b.yes.length !== a.yes.length) return b.yes.length - a.yes.length;
      if (b.mby.length !== a.mby.length) return b.mby.length - a.mby.length;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.s - b.s;
    });

    return { g: g, heat: heat, blocks: blocks, done: done, pending: pending, total: people.length };
  }

  function nameOf(m, id) {
    var p = (m.people || []).filter(function (x) { return x.id === id; })[0];
    return p ? p.name : '（已移除）';
  }
  function namesOf(m, ids) {
    return (ids || []).map(function (i) { return nameOf(m, i); }).join('、');
  }
  function blockLabel(b) {
    return md(b.date) + '（' + wdOf(b.date) + '）' + hm(b.s) + '–' + hm(b.e);
  }

  /* ---------------- 日曆連結 ---------------- */
  function utcStamp(dateStr, min) {
    var d = new Date(dateStr + 'T' + hm(min) + ':00' + CFG.TZ_OFFSET);
    return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' +
      p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + '00Z';
  }
  function calLink(m, b, pageUrl) {
    var guests = (m.people || []).map(function (p) { return p.email; }).filter(Boolean).join(',');
    var q = [
      'action=TEMPLATE',
      'text=' + encodeURIComponent(m.title || '會議'),
      'dates=' + utcStamp(b.date, b.s) + '%2F' + utcStamp(b.date, b.e),
      'ctz=' + encodeURIComponent(CFG.TZ_LABEL),
      'details=' + encodeURIComponent((m.desc || '') + (pageUrl ? '\n\n時段調查：' + pageUrl : '')),
      'location=' + encodeURIComponent(m.location || '')
    ];
    if (guests) q.push('add=' + encodeURIComponent(guests));
    return 'https://calendar.google.com/calendar/render?' + q.join('&');
  }
  function mailto(to, subject, body) {
    return 'mailto:' + encodeURIComponent(to) +
      '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /* ---------------- 格狀選擇表 ----------------
   * mount(box, m, draft, opts)
   *   draft — { key: 1|2 }，會被就地修改
   *   opts  — { readonly, onChange, getMode }
   */
  function mountPicker(box, m, draft, opts) {
    opts = opts || {};
    var g = slots(m);
    var off = opts.editOff ? Object.create(null) : offSet(m);
    var ro = !!opts.readonly;
    var painting = false;

    var h = '<div class="scroll"><table class="gr"><thead><tr><th class="corner"></th>';
    g.dates.forEach(function (d, i) {
      h += '<th class="dh' + (ro ? '' : ' click') + '" data-col="' + i + '">'
        + '<b>' + md(d) + '</b><span>週' + wdOf(d) + '</span></th>';
    });
    h += '</tr></thead><tbody>';
    g.times.forEach(function (t, ri) {
      if (ri > 0 && t !== g.times[ri - 1] + g.step) {
        h += '<tr><th class="th brklab">休息</th><td class="brk" colspan="' + g.dates.length + '"></td></tr>';
      }
      h += '<tr><th class="th' + (t % 60 === 0 ? ' oc' : '') + (ro ? '' : ' click')
        + '" data-row="' + ri + '">' + hm(t) + '</th>';
      g.dates.forEach(function (d) {
        var k = key(d, t), v = +(draft[k] || 0);
        if (off[k] && !opts.editOff) { h += '<td class="c off" data-k="' + k + '"></td>'; return; }
        var cls = 'c' + (v ? ' v' + v : (opts.editOff ? ' xoff' : ''))
          + (ro ? ' ro' : '') + (off[k] ? ' off' : '');
        h += '<td class="' + cls + '" data-k="' + k + '"'
          + (ro ? '' : ' tabindex="0" role="button" aria-label="' + k + '"') + '></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    box.innerHTML = h;
    if (ro) return;

    var cells = box.querySelectorAll('td.c:not(.off)');
    function mode() { return opts.getMode ? opts.getMode() : 2; }
    function set(td, v) {
      var k = td.getAttribute('data-k');
      if (v) draft[k] = v; else delete draft[k];
      td.className = 'c' + (v ? ' v' + v : (opts.editOff ? ' xoff' : ''));
    }
    function changed() { if (opts.onChange) opts.onChange(); }

    /* ---- when2meet 式的塗色：
     *   按下去的那一格決定這一筆是「塗上」還是「擦掉」，
     *   接著拖過去的每一格都沿用同一個方向，不會塗一格擦一格。
     */
    var paintVal = null;
    var lastPointer = 'mouse';

    function cellAt(e) {
      return e.target && e.target.closest ? e.target.closest('td.c:not(.off)') : null;
    }
    function begin(td) {
      var mo = mode();
      var cur = +(draft[td.getAttribute('data-k')] || 0);
      paintVal = (mo === 0 || cur === mo) ? 0 : mo;   // 已經是這個狀態 → 這一筆是擦掉
      set(td, paintVal);
      changed();
    }

    var table = box.querySelector('table.gr');

    table.addEventListener('pointerdown', function (e) {
      lastPointer = e.pointerType || 'mouse';
      // 觸控交給 click 處理：手指按下不代表要選，可能只是想滑動頁面
      if (lastPointer !== 'mouse') return;
      var td = cellAt(e);
      if (!td) return;
      e.preventDefault();
      painting = true;
      begin(td);
    });

    table.addEventListener('pointermove', function (e) {
      if (!painting || paintVal === null) return;
      var td = cellAt(e);
      if (td && +(draft[td.getAttribute('data-k')] || 0) !== paintVal) {
        set(td, paintVal);
        changed();
      }
    });

    function endPaint() { painting = false; paintVal = null; }
    document.addEventListener('pointerup', endPaint);
    document.addEventListener('pointercancel', endPaint);

    // 觸控與筆：用 click（滑動時不會觸發），滑鼠已在 pointerdown 處理過
    table.addEventListener('click', function (e) {
      if (lastPointer === 'mouse') return;
      var td = cellAt(e);
      if (td) { begin(td); paintVal = null; }
    });

    Array.prototype.forEach.call(cells, function (td) {
      td.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          begin(td);
          paintVal = null;
        }
      });
    });

    function group(list) {
      if (!list.length) return;
      if (opts.offFirst) {
        // 建立頁：整列／整天的手勢是「關掉」。只要還有開著的就全部關掉，
        // 全都關著時再按一次才會全部開回來。
        var anyOn = list.some(function (td) { return +(draft[td.getAttribute('data-k')] || 0) !== 0; });
        list.forEach(function (td) { set(td, anyOn ? 0 : 2); });
        changed();
        return;
      }
      var target = mode() === 0 ? 0 : mode();
      var same = list.every(function (td) {
        return +(draft[td.getAttribute('data-k')] || 0) === target;
      });
      list.forEach(function (td) { set(td, same ? 0 : target); });
      changed();
    }
    Array.prototype.forEach.call(box.querySelectorAll('th.dh.click'), function (th) {
      th.addEventListener('click', function () {
        var ci = +th.getAttribute('data-col'), list = [];
        Array.prototype.forEach.call(box.querySelectorAll('tbody tr'), function (tr) {
          var tds = tr.querySelectorAll('td.c');
          if (tds.length && tds[ci] && !tds[ci].classList.contains('off')) list.push(tds[ci]);
        });
        group(list);
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('th.th.click'), function (th) {
      th.addEventListener('click', function () {
        group(Array.prototype.slice.call(th.parentNode.querySelectorAll('td.c:not(.off)')));
      });
    });

    return {
      all: function () { Array.prototype.forEach.call(cells, function (td) { set(td, 2); }); changed(); },
      none: function () { Array.prototype.forEach.call(cells, function (td) { set(td, 0); }); changed(); }
    };
  }

  /* 熱區圖（唯讀，數字＝可以出席人數）
   * opts — { onHover(key, cell), onLeave() }
   */
  function mountHeat(box, m, t, opts) {
    opts = opts || {};
    var g = t.g, max = Math.max(1, t.done.length);
    var h = '<div class="scroll"><table class="gr"><thead><tr><th class="corner"></th>';
    g.dates.forEach(function (d) {
      h += '<th class="dh"><b>' + md(d) + '</b><span>週' + wdOf(d) + '</span></th>';
    });
    h += '</tr></thead><tbody>';
    g.times.forEach(function (tm, ri) {
      if (ri > 0 && tm !== g.times[ri - 1] + g.step) {
        h += '<tr><th class="th brklab">休息</th><td class="brk" colspan="' + g.dates.length + '"></td></tr>';
      }
      h += '<tr><th class="th' + (tm % 60 === 0 ? ' oc' : '') + '">' + hm(tm) + '</th>';
      g.dates.forEach(function (d) {
        var k = key(d, tm), c = t.heat[k];
        if (!c) { h += '<td class="h off" data-k="' + k + '"></td>'; return; }
        var r = c.y / max;
        var bg = c.y === 0 ? 'var(--empty)'
          : 'color-mix(in srgb, var(--yes) ' + Math.round(18 + 82 * r) + '%, var(--surface))';
        var col = c.y === 0 ? 'var(--ink-3)' : (r > 0.55 ? 'var(--surface)' : 'var(--ink)');
        var txt = c.y ? (c.y + (c.y === t.done.length ? '★' : '')) : (c.m ? '·' : '');
        h += '<td class="h" data-k="' + k + '" style="background:' + bg + ';color:' + col
          + '" title="' + k + '｜可以 ' + c.y + '、勉強 ' + c.m + '、不行 ' + c.n + '">' + txt + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    box.innerHTML = h;

    if (opts.onHover) {
      var tbl = box.querySelector('table.gr');
      var cur = null;
      tbl.addEventListener('mouseover', function (e) {
        var td = e.target.closest && e.target.closest('td.h:not(.off)');
        if (!td || td === cur) return;
        if (cur) cur.classList.remove('hot');
        cur = td;
        td.classList.add('hot');
        var k = td.getAttribute('data-k');
        opts.onHover(k, t.heat[k]);
      });
      tbl.addEventListener('mouseleave', function () {
        if (cur) cur.classList.remove('hot');
        cur = null;
        if (opts.onLeave) opts.onLeave();
      });
    }
  }

  /* ---------------- 小 UI helper ---------------- */
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'toast up' + (bad ? ' bad' : '');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = 'toast'; }, 4000);
  }
  function copy(txt, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        function () { toast(ok || '已複製'); },
        function () { toast('複製失敗，請手動選取', true); });
    } else { toast('這個瀏覽器不支援自動複製', true); }
  }
  function q(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }
  function brandTitle() { return (CFG.BRAND || '') + ' 會議預約系統'; }
  function pageUrl(file, params) {
    var base = location.href.replace(/[^/]*$/, '') + file;
    var qs = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k]) qs.push(k + '=' + encodeURIComponent(params[k]));
    });
    return base + (qs.length ? '?' + qs.join('&') : '');
  }

  /* 本機記住「我發起的調查」與身分，純方便用，不是權限 */
  var LS_MINE = 'mv.mine', LS_ME = 'mv.me';
  function remember(code, title) {
    try {
      var list = JSON.parse(localStorage.getItem(LS_MINE) || '[]');
      if (!list.some(function (x) { return x.code === code; })) {
        list.unshift({ code: code, title: title, at: new Date().toISOString() });
        localStorage.setItem(LS_MINE, JSON.stringify(list.slice(0, 50)));
      }
    } catch (e) { /* 無痕模式等情況直接忽略 */ }
  }
  function mine() {
    try { return JSON.parse(localStorage.getItem(LS_MINE) || '[]'); } catch (e) { return []; }
  }
  function meEmail(v) {
    try {
      if (v !== undefined) { localStorage.setItem(LS_ME, v); return v; }
      return localStorage.getItem(LS_ME) || '';
    } catch (e) { return ''; }
  }

  /* ---------------- 回上一層的連結 ----------------
   * 由 CFG.BACK_URL / BACK_LABEL 決定。放在作品集底下時就會出現
   * 「← 回 Ducky Huang」，獨立部署時留空就不會出現。
   */
  function mountBack() {
    if (!CFG.BACK_URL) return;
    var label = '← 回 ' + (CFG.BACK_LABEL || '上一層');
    var rail = document.querySelector('.rail');
    if (rail) {
      var a = document.createElement('a');
      a.className = 'home back';
      a.href = CFG.BACK_URL;
      a.textContent = label;
      rail.insertBefore(a, rail.firstChild);
      return;
    }
    var bar = document.createElement('a');
    bar.className = 'backbar';
    bar.href = CFG.BACK_URL;
    bar.textContent = label;
    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* ---------------- Demo 範例資料 ----------------
   * 只在 demo 模式、而且 localStorage 還是空的時候塞一次。
   * 目的：訪客一進來就看得到一場「已經有人填」的調查，不用先自己建一場。
   * 日期都是相對今天算的，所以這份範例永遠不會過期。
   */
  function seedDemo() {
    if (!window.Store || !Store.isDemo || !Store.demoIsEmpty()) return;

    var code = (CFG.DEMO_CODE || 'DEMOxK7pQ2mR9vT4wY6zB1nC3jH5sL8d');
    var today = new Date();
    var dates = [];
    for (var i = 3; dates.length < 5 && i < 20; i++) {
      var d = new Date(today.getTime() + i * 86400000);
      if (d.getDay() >= 1 && d.getDay() <= 5) dates.push(isoDay(d));
    }
    var deadline = isoDay(new Date(today.getTime() + 2 * 86400000)) + 'T18:00';

    var people = [
      { id: 'demo1', name: '陳雅婷', email: 'alice@example.com', pin: '' },
      { id: 'demo2', name: '林建宏', email: 'bob@example.com', pin: '' },
      { id: 'demo3', name: '王思穎', email: 'carol@example.com', pin: '' },
      { id: 'demo4', name: '張家豪', email: 'dave@example.com', pin: '' },
      { id: 'demo5', name: '李美玲', email: 'erin@example.com', pin: '' }
    ];

    var m = {
      code: code,
      title: 'Q4 產品規劃跨部門會議',
      desc: '這是一場範例調查，資料只存在你這台瀏覽器裡。\n可以隨意點選、送出、切換身分，或到「我發起的調查」看統計。',
      location: '3F 會議室 A',
      lengthMin: 60,
      dates: dates,
      startMin: 540, endMin: 1080, stepMin: 30,
      brkOn: true, brkStart: 720, brkEnd: 780,
      off: [],
      deadline: deadline,
      reminders: [24, 3],
      verifyEmail: false,
      autoInvite: false,
      organizer: { name: 'Ducky', email: 'demo@example.com' },
      people: people,
      createdAt: new Date().toISOString(),
      closed: false,
      outbox: { invitesSent: true, remindersSent: [], resultSent: false }
    };

    /* 最後一天下午不開放，順便展示「未開放」的斜線格長什麼樣 */
    var g = slots(m);
    var last = dates[dates.length - 1];
    g.times.forEach(function (t) { if (t >= 780) m.off.push(key(last, t)); });

    /* 三個人已經填了，湊出一個「全員可以」的時段 */
    function pick(dayIdxs, times) {
      var o = {};
      dayIdxs.forEach(function (di) {
        times.forEach(function (t) {
          var k = key(dates[di], t);
          if (m.off.indexOf(k) < 0) o[k] = 2;
        });
      });
      return o;
    }
    var responses = [
      { pid: 'demo1', name: '陳雅婷', email: 'alice@example.com',
        slots: pick([0, 1, 2], [600, 630, 660]), at: new Date().toISOString() },
      { pid: 'demo2', name: '林建宏', email: 'bob@example.com',
        slots: pick([1, 2], [600, 630, 840, 870]), at: new Date().toISOString() },
      { pid: 'demo3', name: '王思穎', email: 'carol@example.com',
        slots: pick([1, 2, 3], [600, 630, 900]), at: new Date().toISOString() }
    ];
    /* 讓 demo2 有一格是「勉強」，展示三級 */
    responses[1].slots[key(dates[1], 840)] = 1;

    Store.writeJson(meetingPath(code), m, 'demo seed');
    responses.forEach(function (r) {
      Store.writeJson(responsePath(code, r.pid), r, 'demo seed');
    });
    Store.writeJson(indexPath(), [{
      code: code, title: m.title,
      organizerEmail: m.organizer.email, organizerName: m.organizer.name,
      deadline: m.deadline, createdAt: m.createdAt
    }], 'demo seed');
    remember(code, m.title);
    meEmail(m.organizer.email);
  }

  window.Core = {
    WD: WD, p2: p2, hm: hm, toMin: toMin, key: key, md: md, isoDay: isoDay, wdOf: wdOf, esc: esc,
    newCode: newCode, newPin: newPin, newId: newId, validCode: validCode,
    pollDir: pollDir, meetingPath: meetingPath, responsePath: responsePath, indexPath: indexPath,
    deadlineMs: deadlineMs, fmtDeadline: fmtDeadline, isShut: isShut,
    slots: slots, tally: tally, offSet: offSet, isOff: isOff, nameOf: nameOf, namesOf: namesOf, blockLabel: blockLabel,
    calLink: calLink, mailto: mailto, utcStamp: utcStamp,
    mountPicker: mountPicker, mountHeat: mountHeat,
    toast: toast, copy: copy, q: q, brandTitle: brandTitle, pageUrl: pageUrl,
    remember: remember, mine: mine, meEmail: meEmail,
    seedDemo: seedDemo, mountBack: mountBack,
    demoCode: function () { return CFG.DEMO_CODE || ''; }
  };

  seedDemo();
})();
