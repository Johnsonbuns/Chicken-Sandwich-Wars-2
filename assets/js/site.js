/* ChickenSandwichWars.com — client behaviour: search, filters, polls, forms */
(function () {
  /* Loaded async, and everything below runs on DOM ready. Async matters: a
     classic script -- defer included -- is held until every pending stylesheet
     has arrived, and this page's fonts come from fonts.googleapis.com. That
     made the whole script hostage to a third party, so a slow phone connection
     left the menu, search, filters, polls and form handling all inert while the
     page sat there looking finished. An async script is not blocked by
     stylesheets; the readiness guard is what replaces the ordering defer gave.
     Nothing here reads layout, so running before the fonts land is safe. */
  function boot() {
    var root = document.body.getAttribute('data-root') || '';

    /* ---------- mobile drawer ----------
       Scroll is locked by pinning the body rather than by overflow:hidden, which
       iOS Safari ignores on the body element -- without the pin, scrolling the
       drawer scrolls the page behind it and you lose your place on close. */
    var drawer = document.getElementById('siteDrawer');
    var scrim = document.getElementById('drawerScrim');
    var mt = document.getElementById('menuToggle');
    var lockedAt = 0;

    function lockScroll() {
      lockedAt = window.pageYOffset || document.documentElement.scrollTop || 0;
      document.body.style.position = 'fixed';
      document.body.style.top = -lockedAt + 'px';
      document.body.style.width = '100%';
    }
    function unlockScroll() {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, lockedAt);
    }
    function drawerOpen() {
      if (!drawer) return;
      lockScroll();
      drawer.classList.add('open');
      scrim.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      mt.setAttribute('aria-expanded', 'true');
      mt.setAttribute('aria-label', 'Close menu');
      var close = document.getElementById('drawerClose');
      if (close) setTimeout(function () { close.focus(); }, 30);
    }
    function drawerClose() {
      if (!drawer || !drawer.classList.contains('open')) return;
      drawer.classList.remove('open');
      scrim.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      mt.setAttribute('aria-expanded', 'false');
      mt.setAttribute('aria-label', 'Open menu');
      unlockScroll();
      mt.focus();
    }
    if (mt && drawer) {
      mt.addEventListener('click', function () {
        if (drawer.classList.contains('open')) drawerClose(); else drawerOpen();
      });
      scrim.addEventListener('click', drawerClose);
      var dc = document.getElementById('drawerClose');
      if (dc) dc.addEventListener('click', drawerClose);
      /* Following a link inside the drawer navigates away; releasing the scroll
         lock first keeps the body from staying pinned if the browser restores
         this page from the back/forward cache. */
      drawer.addEventListener('click', function (e) {
        if (e.target.closest('a')) drawerClose();
      });
      /* Rotating to landscape can cross the breakpoint, which would leave the
         page scroll-locked behind a drawer that is no longer displayed. */
      window.addEventListener('resize', function () {
        if (window.innerWidth > 760) drawerClose();
      });
    }

    /* ---------- search ---------- */
    var overlay = document.getElementById('searchOverlay');
    var input = document.getElementById('searchInput');
    var results = document.getElementById('searchResults');
    var index = null;

    function loadIndex(cb) {
      if (index) return cb(index);
      fetch(root + 'assets/search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (d) { index = d; cb(index); })
        .catch(function () { index = []; cb(index); });
    }
    function openSearch() {
      if (!overlay) return;
      overlay.classList.add('open');
      loadIndex(function () { render(input.value); });
      setTimeout(function () { input.focus(); }, 30);
    }
    function closeSearch() { if (overlay) overlay.classList.remove('open'); }
    function render(q) {
      if (!results) return;
      q = (q || '').trim().toLowerCase();
      var list = index || [];
      var out = q
        ? list.filter(function (it) { return (it.t + ' ' + it.k).toLowerCase().indexOf(q) !== -1; })
        : list.slice(0, 12);
      out = out.slice(0, 30);
      results.innerHTML = out.length
        ? out.map(function (it) {
            return '<a href="' + root + it.u + '"><div class="t">' + it.t + '</div><div class="s">' + it.s + '</div></a>';
          }).join('')
        : '<a><div class="t">No matches</div><div class="s">Try a brand, operator, market or metric</div></a>';
    }
    var so = document.getElementById('searchOpen');
    if (so) so.addEventListener('click', openSearch);
    if (input) input.addEventListener('input', function () { render(input.value); });
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSearch(); });
    var ds = document.getElementById('drawerSearch');
    if (ds) ds.addEventListener('click', function () { drawerClose(); openSearch(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSearch(); drawerClose(); }
      if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) &&
          ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(document.activeElement.tagName) === -1) {
        e.preventDefault(); openSearch();
      }
    });

    /* ---------- inline page search on standalone search page ---------- */
    var pageSearch = document.getElementById('pageSearchInput');
    if (pageSearch) {
      var pageResults = document.getElementById('pageSearchResults');
      loadIndex(function () { renderPage(''); });
      pageSearch.addEventListener('input', function () { renderPage(pageSearch.value); });
      function renderPage(q) {
        q = (q || '').trim().toLowerCase();
        var list = (index || []).filter(function (it) {
          return !q || (it.t + ' ' + it.k).toLowerCase().indexOf(q) !== -1;
        });
        pageResults.innerHTML = list.map(function (it) {
          return '<a class="card" href="' + root + it.u + '" style="margin-bottom:10px"><h3>' + it.t +
            '</h3><p class="note" style="margin:0">' + it.s + '</p></a>';
        }).join('') || '<div class="empty"><h3>No matches</h3></div>';
      }
    }

    /* ---------- table + card filtering ---------- */
    document.querySelectorAll('[data-filter-group]').forEach(function (group) {
      var targetSel = group.getAttribute('data-filter-group');
      var chips = group.querySelectorAll('.chip');
      var text = group.querySelector('[data-filter-text]');
      function apply() {
        var active = [];
        chips.forEach(function (c) { if (c.classList.contains('on') && c.dataset.filter !== 'all') active.push(c.dataset.filter); });
        var q = text ? text.value.trim().toLowerCase() : '';
        document.querySelectorAll(targetSel).forEach(function (row) {
          var tags = (row.getAttribute('data-tags') || '').toLowerCase();
          var name = (row.getAttribute('data-name') || row.textContent || '').toLowerCase();
          var okTag = !active.length || active.every(function (a) { return tags.indexOf(a.toLowerCase()) !== -1; });
          var okText = !q || name.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
          row.style.display = okTag && okText ? '' : 'none';
        });
      }
      chips.forEach(function (c) {
        c.addEventListener('click', function () {
          if (c.dataset.filter === 'all') chips.forEach(function (x) { x.classList.remove('on'); });
          else group.querySelector('.chip[data-filter="all"]') && group.querySelector('.chip[data-filter="all"]').classList.remove('on');
          c.classList.toggle('on');
          apply();
        });
      });
      if (text) text.addEventListener('input', apply);
    });

    /* ---------- table sorting ---------- */
    document.querySelectorAll('table[data-sortable] th').forEach(function (th, i) {
      th.style.cursor = 'pointer';
      th.title = 'Sort';
      th.addEventListener('click', function () {
        var table = th.closest('table');
        var tbody = table.querySelector('tbody');
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        var asc = table.getAttribute('data-sort-col') === String(i) && table.getAttribute('data-sort-dir') !== 'asc';
        rows.sort(function (a, b) {
          var av = a.children[i] ? a.children[i].textContent.trim() : '';
          var bv = b.children[i] ? b.children[i].textContent.trim() : '';
          var an = parseFloat(av.replace(/[^0-9.\-]/g, ''));
          var bn = parseFloat(bv.replace(/[^0-9.\-]/g, ''));
          var bothNum = !isNaN(an) && !isNaN(bn);
          if (bothNum) return asc ? an - bn : bn - an;
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
        table.setAttribute('data-sort-col', i);
        table.setAttribute('data-sort-dir', asc ? 'asc' : 'desc');
      });
    });

    /* ---------- polls (local to this browser; no invented vote totals) ---------- */
    document.querySelectorAll('[data-poll]').forEach(function (poll) {
      var id = poll.getAttribute('data-poll');
      var key = 'csw.poll.' + id;
      function read() {
        try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
      }
      function write(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
      function paint() {
        var data = read();
        var total = Object.keys(data).reduce(function (s, k) { return s + (k === 'mine' ? 0 : data[k]); }, 0);
        poll.querySelectorAll('.pollopt').forEach(function (btn) {
          var opt = btn.getAttribute('data-opt');
          var n = data[opt] || 0;
          var p = total ? Math.round((n / total) * 100) : 0;
          btn.querySelector('.barfill').style.width = (total ? p : 0) + '%';
          btn.querySelector('.pctv').textContent = total ? p + '% · ' + n : '';
        });
        var meta = poll.querySelector('[data-polltotal]');
        if (meta) {
          meta.textContent = total
            ? total + ' vote' + (total === 1 ? '' : 's') + ' recorded in this browser. CSW does not publish invented vote counts — aggregate results appear once the ballot is wired to the CSW vote service.'
            : 'No votes recorded in this browser yet.';
        }
      }
      poll.querySelectorAll('.pollopt').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var data = read();
          var opt = btn.getAttribute('data-opt');
          data[opt] = (data[opt] || 0) + 1;
          write(data); paint();
        });
      });
      paint();
    });

    /* ---------- forms: never silently drop a submission ---------- */
    document.querySelectorAll('[data-csw-form]').forEach(function (f) {
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var data = new FormData(f);
        var lines = [];
        data.forEach(function (v, k) { if (String(v).trim()) lines.push(k + ': ' + v); });
        var body = lines.join('\n');
        var note = f.querySelector('[data-formnote]');
        if (navigator.clipboard) navigator.clipboard.writeText(body).catch(function () {});
        if (note) note.innerHTML = 'Copied to your clipboard and opening your email client. If nothing opens, email the details to <a href="mailto:desk@chickensandwichwars.com">desk@chickensandwichwars.com</a>.';
        window.location.href = 'mailto:desk@chickensandwichwars.com?subject=' +
          encodeURIComponent('CSW submission: ' + f.id) + '&body=' + encodeURIComponent(body);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
