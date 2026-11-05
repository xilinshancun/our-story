(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'our-story-key';
  var POKE_STORE = 'our-story-poke';
  var POKE_GAP = 10 * 60 * 1000;
  var DAY = 86400000;
  var meta = null;
  var key = null;
  var blobs = {};

  // ---------- 加解密 ----------
  function fromB64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function toB64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }

  function deriveKey(pw) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: fromB64(meta.salt), iterations: meta.iterations, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']
        );
      });
  }
  function decrypt(k, u8) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, k, u8.slice(12))
      .then(function (buf) { return new Uint8Array(buf); });
  }
  function openContent(k) {
    return decrypt(k, fromB64(meta.data)).then(function (u8) {
      return JSON.parse(new TextDecoder().decode(u8));
    });
  }

  // ---------- 解锁 ----------
  function showError(text) {
    var form = $('lockForm');
    $('err').textContent = text;
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
  }

  function enter(k, data) {
    key = k;
    $('lock').hidden = true;
    $('app').hidden = false;
    render(data);
  }

  function tryRemembered() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
    if (!saved || saved.salt !== meta.salt) return Promise.reject();
    return crypto.subtle.importKey('raw', fromB64(saved.k), 'AES-GCM', false, ['decrypt'])
      .then(function (k) { return openContent(k).then(function (data) { enter(k, data); }); })
      .catch(function () { localStorage.removeItem(STORE); throw new Error(); });
  }

  $('lockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!meta) return;
    var go = $('go');
    go.disabled = true;
    go.textContent = '正在打开…';
    $('err').textContent = '';
    var k;
    deriveKey($('pw').value)
      .then(function (derived) { k = derived; return openContent(k); })
      .then(function (data) {
        if ($('remember').checked) {
          crypto.subtle.exportKey('raw', k).then(function (raw) {
            localStorage.setItem(STORE, JSON.stringify({ salt: meta.salt, k: toB64(new Uint8Array(raw)) }));
          });
        }
        enter(k, data);
      })
      .catch(function () {
        showError('密码不对，再试试');
        $('pw').select();
      })
      .then(function () {
        go.disabled = false;
        go.textContent = '进入';
      });
  });

  $('logout').addEventListener('click', function () {
    localStorage.removeItem(STORE);
    location.reload();
  });

  // ---------- 小工具 ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function md(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---------- 渲染 ----------
  function render(d) {
    var names = $('names');
    names.append(d.names[0], el('b', null, '♥'), d.names[1]);
    $('tagline').textContent = d.tagline || '';

    renderCounters(d);
    renderPoke(d.poke);
    renderDays(d);
    renderTimeline(d.timeline || []);

    var places = d.places || [];
    if (places.length) {
      $('placesSec').hidden = false;
      $('placesCount').textContent = places.length + ' 个城市';
      places.forEach(function (p) {
        var c = el('div', 'chip', p.city);
        if (p.date) c.append(el('span', null, p.date));
        $('places').append(c);
      });
    }

    var wishes = d.wishes || [];
    if (wishes.length) {
      $('wishesSec').hidden = false;
      $('wishesCount').textContent = '完成 ' + wishes.filter(function (w) { return w.done; }).length + ' / ' + wishes.length;
      wishes.forEach(function (w) {
        var row = el('div', 'wish' + (w.done ? ' done' : ''));
        row.append(el('div', 'dot', w.done ? '✓' : ''), el('div', 't', w.text));
        $('wishes').append(row);
      });
    }
  }

  function renderCounters(d) {
    var box = $('counters');
    var tickers = [];

    if (d.togetherSince) {
      var start = parseDate(d.togetherSince);
      var c = el('div', 'counter');
      var n = el('div', 'n'), s = el('div', 's');
      c.append(el('div', 'l', '在一起'), n, s);
      box.append(c);
      tickers.push(function (now) {
        var ms = now - start;
        if (ms < 0) { c.hidden = true; return; }
        n.textContent = Math.floor(ms / DAY) + 1;
        n.append(el('small', null, '天'));
        var r = ms % DAY;
        s.textContent = pad(Math.floor(r / 3600000)) + ':' + pad(Math.floor(r / 60000) % 60) + ':' + pad(Math.floor(r / 1000) % 60);
      });
    }

    if (d.nextMeet && d.nextMeet.date) {
      var target = parseDate(d.nextMeet.date);
      var c2 = el('div', 'counter');
      var n2 = el('div', 'n'), s2 = el('div', 's');
      c2.append(el('div', 'l', '距离见面' + (d.nextMeet.place ? ' · ' + d.nextMeet.place : '')), n2, s2);
      box.append(c2);
      tickers.push(function (now) {
        var ms = target - now;
        if (ms <= -DAY) { c2.hidden = true; return; }
        if (ms <= 0) { n2.textContent = '今天'; s2.textContent = '见面啦'; return; }
        n2.textContent = Math.floor(ms / DAY);
        n2.append(el('small', null, '天'));
        var r = ms % DAY;
        s2.textContent = pad(Math.floor(r / 3600000)) + ':' + pad(Math.floor(r / 60000) % 60) + ':' + pad(Math.floor(r / 1000) % 60);
      });
    }

    if (!tickers.length) return;
    function tick() { var now = new Date(); tickers.forEach(function (f) { f(now); }); }
    tick();
    setInterval(tick, 1000);
  }

  function renderPoke(p) {
    if (!p || !p.enabled || !p.serverchanKey) return;
    var btn = $('poke');
    btn.hidden = false;
    btn.textContent = '♥ ' + (p.label || '想你了');
    btn.addEventListener('click', function () {
      var last = Number(localStorage.getItem(POKE_STORE) || 0);
      if (Date.now() - last < POKE_GAP) { toast('刚戳过啦，过一会儿再来～'); return; }
      localStorage.setItem(POKE_STORE, String(Date.now()));
      var url = 'https://sctapi.ftqq.com/' + p.serverchanKey + '.send?title=' + encodeURIComponent(p.message || '想你了');
      fetch(url, { mode: 'no-cors' })
        .then(function () { toast('已经戳到啦 ♥'); })
        .catch(function () {
          localStorage.removeItem(POKE_STORE);
          toast('没戳到，网络好像不太好');
        });
    });
  }

  function renderDays(d) {
    var today = startOfDay(new Date());
    var list = [];

    (d.anniversaries || []).forEach(function (a) {
      var parts = a.date.split('-').map(Number);
      var when;
      if (parts.length === 2) {
        when = new Date(today.getFullYear(), parts[0] - 1, parts[1]);
        if (when < today) when = new Date(today.getFullYear() + 1, parts[0] - 1, parts[1]);
      } else {
        when = new Date(parts[0], parts[1] - 1, parts[2]);
        if (when < today) return;
      }
      list.push({ name: a.name, when: when });
    });

    if (d.togetherSince) {
      var start = parseDate(d.togetherSince);
      var dayNo = Math.floor((today - start) / DAY) + 1;
      var next = [100, 200, 300, 520, 1000, 1314, 2000, 3000].filter(function (m) { return m >= dayNo; })[0];
      if (next) list.push({ name: '在一起第 ' + next + ' 天', when: new Date(start.getFullYear(), start.getMonth(), start.getDate() + next - 1) });
      var years = today.getFullYear() - start.getFullYear();
      var anniv = new Date(start.getFullYear() + years, start.getMonth(), start.getDate());
      if (anniv < today) { years++; anniv = new Date(start.getFullYear() + years, start.getMonth(), start.getDate()); }
      if (years > 0) list.push({ name: '在一起 ' + years + ' 周年', when: anniv });
    }

    if (!list.length) return;
    list.sort(function (a, b) { return a.when - b.when; });
    $('daysSec').hidden = false;
    list.slice(0, 6).forEach(function (x) {
      var left = Math.round((x.when - today) / DAY);
      var row = el('div', 'day');
      var when = el('div', 'when');
      if (left === 0) when.append(el('b', null, '就是今天'));
      else { when.append(md(x.when) + ' · 还有 '); when.append(el('b', null, String(left))); when.append(' 天'); }
      row.append(el('div', null, x.name), when);
      $('days').append(row);
    });
  }

  // ---------- 照片 ----------
  function photoUrl(id, size) {
    var name = id + '-' + size;
    if (!blobs[name]) {
      blobs[name] = fetch('p/' + name + '.bin')
        .then(function (r) { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
        .then(function (buf) { return decrypt(key, new Uint8Array(buf)); })
        .then(function (u8) { return URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' })); });
    }
    return blobs[name];
  }

  var observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          observer.unobserve(en.target);
          load(en.target);
        });
      }, { rootMargin: '300px' })
    : null;

  function load(img) {
    photoUrl(img.dataset.id, img.dataset.size).then(function (url) {
      img.onload = function () { img.classList.add('ok'); };
      img.src = url;
    }, function () { img.parentNode.hidden = true; });
  }

  function openViewer(p) {
    var v = $('viewer'), img = $('viewerImg');
    img.removeAttribute('src');
    v.hidden = false;
    photoUrl(p.id, 'thumb').then(function (url) { if (!img.src) img.src = url; });
    photoUrl(p.id, 'full').then(function (url) { img.src = url; });
  }
  $('viewer').addEventListener('click', function () { $('viewer').hidden = true; });

  function renderTimeline(items) {
    var tl = $('timeline');
    items.forEach(function (t) {
      var item = el('div', 'item');
      var box = el('div', 'card');
      box.append(el('div', 'meta', [t.date, t.place].filter(Boolean).join(' · ')));
      box.append(el('h3', null, t.title));
      if (t.text) box.append(el('p', null, t.text));
      var photos = t.photos || [];
      if (photos.length) {
        var g = el('div', 'photos' + (photos.length === 1 ? ' one' : photos.length === 2 || photos.length === 4 ? ' two' : ''));
        photos.forEach(function (p) {
          var btn = el('button', 'ph');
          btn.type = 'button';
          btn.setAttribute('aria-label', '看大图');
          var single = photos.length === 1;
          if (single) btn.style.aspectRatio = p.w + ' / ' + p.h;
          var img = el('img');
          img.alt = '';
          img.dataset.id = p.id;
          img.dataset.size = single ? 'full' : 'thumb';
          btn.append(img);
          btn.addEventListener('click', function () { openViewer(p); });
          g.append(btn);
          if (observer) observer.observe(img); else load(img);
        });
        box.append(g);
      }
      item.append(box);
      tl.append(item);
    });
  }

  // ---------- 启动 ----------
  if (!window.crypto || !crypto.subtle) {
    $('lockForm').querySelector('p').textContent = '这个浏览器打不开，换个浏览器试试';
    $('go').disabled = true;
    return;
  }
  fetch('content.enc', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (m) {
      meta = m;
      return tryRemembered().catch(function () { $('pw').focus(); });
    })
    .catch(function () { showError('网络不太好，刷新一下试试'); });
})();
