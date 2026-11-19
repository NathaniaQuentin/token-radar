// Token Radar's dashboard: the board, its filters, its detail views, and its methodology.
// Reads window.RADAR (data.js, written beside this page) and fetches nothing. Every figure on the
// page comes from the sealed snapshot; the detail view recomputes each row's implied value from the
// row's own figures and says whether it matches the board.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="9">No radar data loaded.</td></tr>';
    return;
  }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var fmtInt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var fmtMoney = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + fmtInt(n);
  };
  var fmtPct = function (n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return s;
  };
  var fmtAge = function (d) {
    if (d === null || d === undefined) return '—';
    if (d >= 365) return (d / 365).toFixed(1) + ' yrs';
    return d + ' days';
  };
  var clsPct = function (n) { return n === null || n === undefined ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : ''; };

  var maxImplied = 1;
  R.rows.forEach(function (r) { if (r.implied_value_usd > maxImplied) maxImplied = r.implied_value_usd; });
  var maxMcap = 1;
  R.live.forEach(function (r) { if (r.mcap_usd && r.mcap_usd > maxMcap) maxMcap = r.mcap_usd; });

  // --- state, kept in the hash so a view can be linked and screenshotted ----------------------
  var state = { q: '', category: '', chain: '', watchlist: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var parts = h ? h.split('&') : [];
    var next = { q: '', category: '', chain: '', watchlist: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };
    parts.forEach(function (p) {
      var kv = p.split('=');
      var k = kv[0];
      var v = kv[1] ? decodeURIComponent(kv[1].replace(/\+/g, ' ')) : '';
      if (k === 'q') next.q = v;
      else if (k === 'category') next.category = v;
      else if (k === 'chain') next.chain = v;
      else if (k === 'watchlist') next.watchlist = v === '1';
      else if (k === 'tab') next.tab = v === 'live' ? 'live' : 'pre';
      else if (k === 'sort') next.sort = v;
      else if (k === 'dir') next.dir = v === '-1' ? -1 : 1;
      else if (k === 'p') next.selected = v;
    });
    state = next;
  }
  function writeHash() {
    var p = [];
    if (state.q) p.push('q=' + encodeURIComponent(state.q));
    if (state.category) p.push('category=' + encodeURIComponent(state.category));
    if (state.chain) p.push('chain=' + encodeURIComponent(state.chain));
    if (state.watchlist) p.push('watchlist=1');
    if (state.tab === 'live') p.push('tab=live');
    if (state.sort !== 'rank' || state.dir !== 1) { p.push('sort=' + encodeURIComponent(state.sort)); p.push('dir=' + state.dir); }
    if (state.selected) p.push('p=' + encodeURIComponent(state.selected));
    var h = p.length ? '#' + p.join('&') : '#';
    if (window.location.hash !== h) history.replaceState(null, '', h);
  }

  // --- header, facts, methodology -------------------------------------------------------------
  $('top-meta').textContent = 'Snapshot ' + R.as_of + ' · DefiLlama protocols · Model ' + R.model_version;
  $('as-of').textContent = R.as_of;
  var totalImplied = R.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
  var top = R.rows[0];
  $('facts').innerHTML =
    '<div class="fact"><b>' + R.board_size + '</b><span>protocols ranked</span></div>' +
    '<div class="fact"><b>' + R.watchlist_size + '/' + R.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div class="fact"><b>' + R.early_size + '</b><span>early rows below the floor</span></div>' +
    '<div class="fact"><b>' + fmtMoney(totalImplied) + '</b><span>total implied value</span></div>' +
    '<div class="fact"><b>' + fmtMoney(top.implied_value_usd) + '</b><span>top: ' + esc(top.name) + '</span></div>' +
    '<div class="fact"><b>' + R.global_multiple.toFixed(3) + '&times;</b><span>all-category median mcap / TVL</span></div>';
  $('count-pre').textContent = '(' + R.board_size + ')';
  $('count-live').textContent = '(' + R.live_size + ')';

  var compHtml = '<table class="comp-table"><thead><tr><th>Category</th><th class="num">Live comparables</th><th class="num">Median mcap / TVL</th><th class="num">Multiple used</th></tr></thead><tbody>';
  R.comparables.forEach(function (c) {
    compHtml += '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.samples + '</td><td class="num">' + c.median.toFixed(3) + '&times;</td><td class="num">' + c.used.toFixed(3) + '&times;</td></tr>';
  });
  compHtml += '</tbody></table><p class="caveat">Categories with fewer than five live-token comparables fall back to the all-category median of ' + R.global_multiple.toFixed(3) + '&times;. The multiple used is the category median blended half and half with that all-category median.</p>';
  $('comparables').innerHTML = compHtml;

  // --- filter selects --------------------------------------------------------------------------
  var cats = {};
  var chains = {};
  R.rows.concat(R.live).forEach(function (r) {
    if (r.category) cats[r.category] = true;
    (r.chains || []).forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('category').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });

  // --- filtering and sorting -------------------------------------------------------------------
  function matchRow(r) {
    if (state.q) {
      var q = state.q.toLowerCase();
      if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
    }
    if (state.category && r.category !== state.category) return false;
    if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.watchlist && state.tab === 'pre' && !r.watchlist) return false;
    return true;
  }
  function sortVal(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'category') return (r.category || '').toLowerCase();
    if (key === 'age_days') return r.age_days === null || r.age_days === undefined ? -1 : r.age_days;
    if (key === 'change_7d') return r.change_7d === null || r.change_7d === undefined ? -999 : r.change_7d;
    if (key === 'implied_value_usd' && state.tab === 'live') return r.mcap_usd || 0;
    return r[key] === undefined || r[key] === null ? 0 : r[key];
  }
  function sorted(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var va = sortVal(a, key);
      var vb = sortVal(b, key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // --- table rendering -------------------------------------------------------------------------
  function rowHtml(r, isLive) {
    var value = isLive ? (r.mcap_usd || 0) : r.implied_value_usd;
    var max = isLive ? maxMcap : maxImplied;
    var pct = Math.max(2, Math.round((value / max) * 100));
    var rankCell = isLive
      ? '<span class="rank-badge early">' + fmtInt(r.rank || 0) + '</span>'
      : '<span class="rank-badge' + (r.watchlist ? '' : ' early') + '">' + r.rank + '</span>';
    var badge = isLive
      ? '<span class="badge live">Live</span>'
      : r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early</span>';
    var age = isLive ? '—' : fmtAge(r.age_days);
    var chains = (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '');
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td>' + rankCell + '</td>' +
      '<td><span class="proto-name">' + esc(r.name) + '</span><br><span class="proto-slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(chains || '—') + '</td>' +
      '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>' +
      '<td class="num ' + clsPct(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
      '<td class="num">' + age + '</td>' +
      '<td class="num"><span class="value-bar"><i style="width:' + pct + '%"></i></span>' + fmtMoney(value) + '</td>' +
      '<td>' + badge + '</td></tr>';
  }

  function render() {
    // controls reflect state
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('watchlist-only').checked = state.watchlist;
    document.querySelectorAll('.tab').forEach(function (t) {
      var active = t.getAttribute('data-tab') === state.tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    // sort indicators
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      if (th.getAttribute('data-sort') === state.sort) th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    var lastTh = document.querySelector('th[data-sort="implied_value_usd"]');
    if (lastTh) lastTh.textContent = state.tab === 'live' ? 'Market cap' : 'Implied value';

    var isLive = state.tab === 'live';
    var source = isLive
      ? R.live.map(function (r, i) { var c = {}; for (var k in r) c[k] = r[k]; c.rank = i + 1; return c; })
      : R.rows;
    var list = sorted(source.filter(matchRow));
    $('rows').innerHTML = list.map(function (r) { return rowHtml(r, isLive); }).join('');
    $('empty').hidden = list.length > 0;
    $('result-line').textContent = isLive
      ? 'Showing ' + list.length + ' of ' + R.live_size + ' live-token protocols, by market cap. The market\'s own values — never a model\'s.'
      : 'Showing ' + list.length + ' of ' + R.board_size + ' pre-token protocols · watchlist ' + R.watchlist_size + '/' + R.watchlist_size + ' covered · ranked by implied value.';
    // detail view follows the hash
    if (state.selected) openDetail(state.selected);
    else if ($('detail').open) $('detail').close();
  }

  // --- detail view ------------------------------------------------------------------------------
  function recompute(r) {
    return Math.max(1, Math.round(r.tvl_usd * r.multiple * r.growth_multiplier * r.maturity_multiplier * r.chain_multiplier));
  }
  function farmTotals(r) {
    var weeks = Math.ceil(r.farm_hold_days / 7);
    var gas = r.farm_gas_setup_usd + r.farm_gas_weekly_usd * weeks;
    return { weeks: weeks, gas: gas };
  }
  function openDetail(slug) {
    var pre = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { pre = R.rows[i]; break; }
    var body = $('detail-body');
    if (pre) {
      var re = recompute(pre);
      var ok = re === pre.implied_value_usd;
      var comp = null;
      for (var j = 0; j < R.comparables.length; j++) if (R.comparables[j].category === pre.category) { comp = R.comparables[j]; break; }
      var sameCat = R.live.filter(function (l) { return l.category === pre.category; });
      var t = farmTotals(pre);
      var html = '<div class="detail-head"><h2>' + esc(pre.name) + '</h2>' +
        (pre.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early</span>') + '</div>' +
        '<p class="detail-meta">' + esc(pre.slug) + ' · ' + esc(pre.category || '—') + ' · ' + esc((pre.chains || []).join(', ') || '—') +
        ' · rank ' + pre.rank + ' of ' + R.board_size + ' · snapshot ' + R.as_of + '</p>' +
        '<dl class="detail-grid">' +
        '<div><dt>TVL</dt><dd>' + fmtMoney(pre.tvl_usd) + '</dd></div>' +
        '<div><dt>7-day change</dt><dd class="' + clsPct(pre.change_7d) + '">' + fmtPct(pre.change_7d) + '</dd></div>' +
        '<div><dt>Age with no token</dt><dd>' + fmtAge(pre.age_days) + '</dd></div>' +
        '<div><dt>Implied value</dt><dd><b>' + fmtMoney(pre.implied_value_usd) + '</b></dd></div>' +
        '<div><dt>Comparable multiple</dt><dd>' + pre.multiple.toFixed(3) + '&times;</dd></div>' +
        '<div><dt>Growth multiplier</dt><dd>' + pre.growth_multiplier.toFixed(3) + '&times;</dd></div>' +
        '<div><dt>Maturity multiplier</dt><dd>' + pre.maturity_multiplier.toFixed(3) + '&times;</dd></div>' +
        '<div><dt>Chain multiplier</dt><dd>' + pre.chain_multiplier.toFixed(3) + '&times;</dd></div>' +
        '</dl>' +
        '<p class="model-note">TVL ' + fmtMoney(pre.tvl_usd) + ' &times; multiple ' + pre.multiple.toFixed(3) + '&times; &times; growth ' + pre.growth_multiplier.toFixed(3) + '&times; &times; maturity ' + pre.maturity_multiplier.toFixed(3) + '&times; &times; chains ' + pre.chain_multiplier.toFixed(3) + '&times; = ' + fmtMoney(pre.implied_value_usd) + '. ' +
        'Recomputed from these figures: ' + fmtMoney(re) + (ok ? ' — matches the board.' : ' — differs from the board by ' + fmtMoney(Math.abs(re - pre.implied_value_usd)) + '.') + '</p>';
      if (comp) {
        html += '<p class="model-note">The multiple comes from ' + comp.samples + ' live-token ' + esc(pre.category) + ' protocols, whose median market-cap / TVL is ' + comp.median.toFixed(3) + '&times;, blended half and half with the all-category median of ' + R.global_multiple.toFixed(3) + '&times;.</p>';
      }
      if (sameCat.length) {
        html += '<p class="model-note">Live-token protocols in the same category: ' + sameCat.map(function (l) {
          return esc(l.name) + ' (' + (l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd).toFixed(2) : '—') + '&times;)';
        }).join(', ') + '.</p>';
      }
      html += '<h2>Farm plan</h2><ol class="farm">';
      pre.farm.forEach(function (s) {
        html += '<li>' + esc(s.text) + '<div class="cost-time">Cost: <b>' + esc(s.cost) + '</b> · Time: <b>' + esc(s.time) + '</b></div></li>';
      });
      html += '</ol><p class="model-note">Plan total: $' + pre.farm_capital_usd + ' of capital, about $' + t.gas + ' of gas over ' + t.weeks + ' weeks, hold at least ' + pre.farm_hold_days + ' days. Costs are estimates from the chain\'s own fee market, not quotes.</p>';
      body.innerHTML = html;
    } else {
      var live = null;
      for (var k = 0; k < R.live.length; k++) if (R.live[k].slug === slug) { live = R.live[k]; break; }
      if (!live) { body.innerHTML = '<h2>Not found</h2><p>No protocol with slug ' + esc(slug) + ' is on this board.</p>'; }
      else {
        var mult = live.mcap_usd && live.tvl_usd ? (live.mcap_usd / live.tvl_usd).toFixed(3) : '—';
        body.innerHTML = '<div class="detail-head"><h2>' + esc(live.name) + '</h2><span class="badge live">Live</span></div>' +
          '<p class="detail-meta">' + esc(live.slug) + ' · ' + esc(live.category || '—') + ' · ' + esc((live.chains || []).join(', ') || '—') + '</p>' +
          '<dl class="detail-grid">' +
          '<div><dt>TVL</dt><dd>' + fmtMoney(live.tvl_usd) + '</dd></div>' +
          '<div><dt>Market cap</dt><dd><b>' + fmtMoney(live.mcap_usd || 0) + '</b></dd></div>' +
          '<div><dt>Market-cap / TVL</dt><dd>' + mult + '&times;</dd></div>' +
          '<div><dt>7-day change</dt><dd class="' + clsPct(live.change_7d) + '">' + fmtPct(live.change_7d) + '</dd></div>' +
          '</dl>' +
          '<p class="model-note">This protocol already trades. The board shows the market\'s own value, not a model\'s — it is here so the pre-token ranking can be read against real launches, not so it can be farmed as one.</p>';
      }
    }
    var d = $('detail');
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }

  // --- events ------------------------------------------------------------------------------------
  $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); render(); });
  $('category').addEventListener('change', function () { state.category = $('category').value; writeHash(); render(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); render(); });
  $('watchlist-only').addEventListener('change', function () { state.watchlist = $('watchlist-only').checked; writeHash(); render(); });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      state.tab = t.getAttribute('data-tab');
      state.sort = 'rank'; state.dir = 1;
      writeHash(); render();
    });
  });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = 1; }
      writeHash(); render();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.selected = tr.getAttribute('data-slug');
    writeHash(); render();
  });
  $('detail').addEventListener('close', function () {
    if (state.selected) { state.selected = null; writeHash(); }
  });
  window.addEventListener('hashchange', function () { readHash(); render(); });

  readHash();
  render();
})();
