/* ─── State ─────────────────────────────────────────────────── */
const state = {
  currentPage: 'home',
  filters: { category: 'all', fuel: 'all', minPrice: 0, maxPrice: Infinity, sort: 'rating' },
  compareList: [],
  wishlist: JSON.parse(localStorage.getItem('wishlist') || '[]'),
  currentPlan: 'basic',
  analyticsViewed: 0,
  searchQuery: '',
  listingPage: 1,
  pageSize: 12
};

/* ─── Utility ───────────────────────────────────────────────── */
const fmt = {
  price: v => v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${v.toLocaleString('en-IN')}`,
  num: v => v.toLocaleString('en-IN'),
  pct: v => `${v}%`
};

function $(id) { return document.getElementById(id); }
function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

/* Image fallback chain: imagin.studio → Wikimedia Commons pressImageUrl → inline SVG.
   The dataset flag prevents infinite onerror loops. */
function imgFallback(el, pressUrl, label) {
  if (el.dataset.fallback === '2') return;
  if (el.dataset.fallback === '1' || !pressUrl) {
    el.dataset.fallback = '2';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'>`
      + `<rect width='640' height='360' fill='%231e293b'/>`
      + `<text x='50%25' y='44%25' font-family='system-ui,sans-serif' font-size='22' fill='%2394a3b8' text-anchor='middle'>${encodeURIComponent(label)}</text>`
      + `<text x='50%25' y='58%25' font-family='system-ui,sans-serif' font-size='13' fill='%2364748b' text-anchor='middle'>Image unavailable</text>`
      + `</svg>`;
    el.src = `data:image/svg+xml,${svg}`;
  } else {
    el.dataset.fallback = '1';
    el.src = pressUrl;
  }
}

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  $('toast-container').appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

/* ─── Router ────────────────────────────────────────────────── */
function navigate(page, data = {}) {
  state.currentPage = page;
  qsa('.page').forEach(p => p.classList.remove('active'));
  const pg = $(`page-${page}`);
  if (pg) pg.classList.add('active');
  qsa('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  window.scrollTo(0, 0);
  if (page === 'home') renderHome();
  else if (page === 'listings') renderListings();
  else if (page === 'analytics') renderAnalytics();
  else if (page === 'compare') renderCompare();
  else if (page === 'pricing') renderPricing();
  else if (page === 'detail' && data.id) renderDetail(data.id);
}

/* ─── HOME ──────────────────────────────────────────────────── */
function renderHome() {
  // Pick the top-scoring car from each major segment for diversity
  const segmentMap = {
    'Hatchback':   c => c.category === 'Hatchback',
    'Sedan':       c => c.category === 'Sedan',
    'Compact SUV': c => c.category === 'Compact SUV',
    'Mid SUV':     c => c.category === 'SUV',
    'Large SUV':   c => c.category === 'Large SUV',
    'MPV':         c => c.category === 'MPV',
    'Electric':    c => c.fuel === 'Electric',
    'Hybrid':      c => c.fuel === 'Hybrid',
    'Luxury':      c => c.category.startsWith('Luxury'),
  };
  const featured = Object.values(segmentMap)
    .map(fn => [...CAR_DATABASE].filter(fn).sort((a,b) => b.analyticsScore - a.analyticsScore)[0])
    .filter(Boolean);
  $('featured-grid').innerHTML = featured.map(carCard).join('');
  attachCardEvents();

  // Stats
  $('stat-cars').textContent = CAR_DATABASE.length + '+';
  $('stat-reviews').textContent = CAR_DATABASE.reduce((s, c) => s + c.reviews, 0).toLocaleString();
  $('stat-users').textContent = '12,400+';
  $('stat-accuracy').textContent = '97%';
}

function carCard(car) {
  const inWish = state.wishlist.includes(car.id);
  const inComp = state.compareList.includes(car.id);
  const stars = '★'.repeat(Math.floor(car.rating)) + (car.rating % 1 >= 0.5 ? '½' : '') + '☆'.repeat(5 - Math.ceil(car.rating));
  const trendIcon = car.marketTrend === 'rising' ? '↑' : car.marketTrend === 'falling' ? '↓' : '→';
  const trendClass = car.marketTrend === 'rising' ? 'trend-up' : car.marketTrend === 'falling' ? 'trend-down' : 'trend-stable';
  return `
  <div class="car-card${car.discontinued ? ' card-discontinued' : ''}" data-id="${car.id}">
    <div class="card-image-wrap">
      <img src="${car.image}" alt="${car.make} ${car.model}" loading="lazy" onerror="imgFallback(this,'${car.pressImageUrl||''}','${car.make} ${car.model}')">
      ${car.discontinued ? '<span class="badge badge-discontinued">DISCONTINUED</span>' : `<span class="badge badge-tag">${car.tag}</span>`}
      <span class="badge badge-fuel badge-${car.fuel.toLowerCase().replace(' ','-')}">${car.fuel}</span>
      <button class="icon-btn wish-btn ${inWish ? 'wished' : ''}" data-id="${car.id}" title="Wishlist">♥</button>
      <span class="img-verify-badge ${car.imageVerified ? 'img-verified' : 'img-pending'}" title="${car.imageVerified ? 'Image verified against manufacturer source' : 'Image pending official manufacturer verification'}">${car.imageVerified ? '✓' : '!'}</span>
    </div>
    <div class="card-body">
      <div class="card-header-row">
        <div>
          <p class="car-make">${car.make}</p>
          <h3 class="car-model">${car.model} <span class="car-variant">${car.variant}</span></h3>
        </div>
        <div class="analytics-score" title="Analytics Score">
          <span class="score-val">${car.analyticsScore}</span>
          <span class="score-label">Score</span>
        </div>
      </div>
      <p class="car-price">${fmt.price(car.price)} <span class="car-year">${car.year}</span></p>
      <div class="card-specs">
        <span title="Mileage">${car.fuel === 'Electric' ? '🔋 ' + car.engine : '⛽ ' + car.mileage + ' km/l'}</span>
        <span title="Power">⚡ ${car.power}</span>
        <span title="Transmission">⚙️ ${car.transmission}</span>
      </div>
      <div class="card-rating">
        <span class="stars">${stars}</span>
        <span class="rating-val">${car.rating}</span>
        <span class="review-count">(${car.reviews} reviews)</span>
        <span class="market-trend ${trendClass}">${trendIcon} ${car.marketTrend}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm detail-btn" data-id="${car.id}">View Details</button>
        <button class="btn btn-outline btn-sm compare-btn ${inComp ? 'active' : ''}" data-id="${car.id}">${inComp ? '✓ Comparing' : '+ Compare'}</button>
      </div>
    </div>
  </div>`;
}

function attachCardEvents() {
  qsa('.detail-btn').forEach(b => b.addEventListener('click', e => {
    navigate('detail', { id: +e.currentTarget.dataset.id });
  }));
  qsa('.wish-btn').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const id = +e.currentTarget.dataset.id;
    const idx = state.wishlist.indexOf(id);
    if (idx === -1) { state.wishlist.push(id); toast('Added to wishlist ♥', 'success'); }
    else { state.wishlist.splice(idx, 1); toast('Removed from wishlist', 'info'); }
    localStorage.setItem('wishlist', JSON.stringify(state.wishlist));
    e.currentTarget.classList.toggle('wished');
  }));
  qsa('.compare-btn').forEach(b => b.addEventListener('click', e => {
    const id = +e.currentTarget.dataset.id;
    const idx = state.compareList.indexOf(id);
    if (idx === -1) {
      if (state.compareList.length >= 3) { toast('Max 3 cars for comparison', 'error'); return; }
      state.compareList.push(id); toast('Added to compare', 'success');
    } else { state.compareList.splice(idx, 1); toast('Removed from compare', 'info'); }
    updateCompareBar();
    e.currentTarget.classList.toggle('active');
    e.currentTarget.textContent = state.compareList.includes(id) ? '✓ Comparing' : '+ Compare';
  }));
}

function updateCompareBar() {
  const bar = $('compare-bar');
  const count = state.compareList.length;
  bar.classList.toggle('visible', count > 0);
  $('compare-bar-count').textContent = `${count} car${count > 1 ? 's' : ''} selected`;
}

/* ─── LISTINGS ──────────────────────────────────────────────── */
function renderListings() {
  applyFilters();
}

function applyFilters(resetPage = true) {
  if (resetPage) state.listingPage = 1;
  let cars = [...CAR_DATABASE];
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    cars = cars.filter(c => `${c.make} ${c.model} ${c.variant} ${c.category}`.toLowerCase().includes(q));
  }
  if (state.filters.category !== 'all') {
    const cat = state.filters.category;
    if (cat === 'EV')     cars = cars.filter(c => c.fuel === 'Electric');
    else if (cat === 'Hybrid')  cars = cars.filter(c => c.fuel === 'Hybrid');
    else if (cat === 'Luxury')  cars = cars.filter(c => c.category.startsWith('Luxury'));
    else if (cat === 'Sports')  cars = cars.filter(c => c.category.startsWith('Sports'));
    else if (cat === 'All SUV') cars = cars.filter(c => ['Compact SUV','SUV','Large SUV'].includes(c.category));
    else cars = cars.filter(c => c.category === cat);
  }
  if (state.filters.fuel !== 'all') cars = cars.filter(c => c.fuel === state.filters.fuel);
  cars = cars.filter(c => c.price >= state.filters.minPrice && c.price <= (state.filters.maxPrice || Infinity));

  const sort = state.filters.sort;
  if (sort === 'price-asc') cars.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') cars.sort((a, b) => b.price - a.price);
  else if (sort === 'rating') cars.sort((a, b) => b.rating - a.rating);
  else if (sort === 'mileage') cars.sort((a, b) => b.mileage - a.mileage);
  else if (sort === 'score') cars.sort((a, b) => b.analyticsScore - a.analyticsScore);

  const total = cars.length;
  const totalPages = Math.ceil(total / state.pageSize);
  const start = (state.listingPage - 1) * state.pageSize;
  const paginated = cars.slice(start, start + state.pageSize);

  $('listings-grid').innerHTML = total
    ? paginated.map(carCard).join('')
    : `<div class="empty-state"><div class="empty-icon">🔍</div><p>No cars match your filters.</p><button class="btn btn-outline" onclick="resetFilters()">Reset Filters</button></div>`;

  $('results-count').textContent = `${total} car${total !== 1 ? 's' : ''} found · Showing ${start + 1}–${Math.min(start + state.pageSize, total)}`;

  // Pagination controls
  let paginationEl = $('pagination-controls');
  if (!paginationEl) {
    paginationEl = document.createElement('div');
    paginationEl.id = 'pagination-controls';
    paginationEl.className = 'pagination';
    $('listings-grid').after(paginationEl);
  }
  if (totalPages <= 1) { paginationEl.innerHTML = ''; }
  else {
    paginationEl.innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="changePage(-1)" ${state.listingPage === 1 ? 'disabled' : ''}>← Prev</button>
      <span class="page-info">Page ${state.listingPage} of ${totalPages}</span>
      <button class="btn btn-outline btn-sm" onclick="changePage(1)" ${state.listingPage === totalPages ? 'disabled' : ''}>Next →</button>`;
  }
  attachCardEvents();
}

function changePage(dir) {
  state.listingPage += dir;
  applyFilters(false);
  window.scrollTo(0, 0);
}

function resetFilters() {
  state.filters = { category: 'all', fuel: 'all', minPrice: 0, maxPrice: Infinity, sort: 'rating' };
  state.searchQuery = '';
  qsa('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.value === 'all'));
  $('sort-select').value = 'rating';
  $('search-input').value = '';
  applyFilters();
}

/* ─── DETAIL ────────────────────────────────────────────────── */
function renderDetail(id) {
  const car = CAR_DATABASE.find(c => c.id === id);
  if (!car) return navigate('listings');

  const simRaw = CAR_DATABASE.filter(c => c.id !== id && (c.category === car.category || c.make === car.make)).slice(0, 3);

  $('detail-content').innerHTML = `
  <div class="detail-hero">
    <div class="detail-image-wrap">
      <img src="${car.image}" alt="${car.make} ${car.model}" onerror="imgFallback(this,'${car.pressImageUrl||''}','${car.make} ${car.model}')">
      <span class="badge badge-tag" style="position:absolute;top:16px;left:16px">${car.tag}</span>
      <span class="img-verify-badge ${car.imageVerified ? 'img-verified' : 'img-pending'}" style="position:absolute;bottom:12px;left:12px;font-size:0.72rem;padding:4px 10px" title="${car.imageVerified ? 'Image verified — imagin.studio manufacturer render' : 'Image pending official manufacturer press-kit verification'}">${car.imageVerified ? '✓ Image Verified' : '⚠ Image Unverified'}</span>
    </div>
    <div class="detail-info">
      <p class="car-make large">${car.make} · ${car.year}</p>
      <h2 class="detail-title">${car.model} <span style="color:var(--text-muted)">${car.variant}</span></h2>
      ${car.discontinued ? `<div class="discontinued-warning">⚠️ <strong>Discontinued in India</strong> — This model is no longer sold new. Check certified pre-owned or used-car markets.</div>` : ''}
      <p class="detail-price">${fmt.price(car.price)}</p>
      <div class="detail-quick-specs">
        <div class="qs-item"><span class="qs-icon">⛽</span><span>${car.fuel === 'Electric' ? car.engine : car.mileage + ' km/l'}</span></div>
        <div class="qs-item"><span class="qs-icon">⚡</span><span>${car.power}</span></div>
        <div class="qs-item"><span class="qs-icon">⚙️</span><span>${car.transmission}</span></div>
        <div class="qs-item"><span class="qs-icon">👥</span><span>${car.seats} seats</span></div>
        <div class="qs-item"><span class="qs-icon">🎨</span><span>${car.color}</span></div>
        <div class="qs-item"><span class="qs-icon">🛡️</span><span>${car.safetyRating}★ Safety</span></div>
      </div>
      <div class="detail-actions">
        ${car.discontinued ? `<button class="btn btn-outline" disabled title="No longer available new" style="opacity:0.4;cursor:not-allowed">Book Test Drive (Unavailable)</button>` : `<button class="btn btn-primary" onclick="toast('Booking consultation scheduled!','success')">Book Test Drive</button>`}
        <button class="btn btn-outline" onclick="toast('EMI Calculator coming in Pro','info')">Calculate EMI</button>
        <button class="btn btn-ghost wish-btn ${state.wishlist.includes(car.id)?'wished':''}" data-id="${car.id}" onclick="toggleWishDetail(${car.id},this)">♥ Wishlist</button>
      </div>
      <div class="analytics-panel">
        <div class="ap-score ${car.analyticsScore >= 85 ? 'ap-excellent' : car.analyticsScore >= 70 ? 'ap-good' : 'ap-fair'}">
          <span class="ap-num">${car.analyticsScore}</span><span class="ap-label">Analytics Score</span>
        </div>
        <div class="ap-items">
          <div class="ap-item"><span>Market Trend</span><span class="trend-${car.marketTrend}">${car.marketTrend === 'rising' ? '↑ Rising' : car.marketTrend === 'falling' ? '↓ Falling' : '→ Stable'}</span></div>
          <div class="ap-item"><span>Demand Index</span><span>${car.demandIndex}/100</span></div>
          <div class="ap-item"><span>Depreciation/yr</span><span>${car.depreciationRate}%</span></div>
          <div class="ap-item"><span>5yr Ownership Cost</span><span>${fmt.price(car.totalCostOfOwnership5yr)}</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="detail-tabs">
    <div class="tab-nav">
      <button class="tab-btn active" onclick="switchTab('specs', this)">Specs</button>
      <button class="tab-btn" onclick="switchTab('features', this)">Features</button>
      <button class="tab-btn" onclick="switchTab('insights', this)">AI Insights</button>
      <button class="tab-btn" onclick="switchTab('cost', this)">Cost Analysis</button>
      <button class="tab-btn" onclick="switchTab('emi', this)">EMI Calculator</button>
    </div>

    <div id="tab-specs" class="tab-content active">
      <div class="specs-grid">
        ${[['Engine', car.engine], ['Power', car.power], ['Torque', car.torque],
           ['Fuel Type', car.fuel], ['Transmission', car.transmission], ['Mileage', car.fuel === 'Electric' ? 'N/A' : car.mileage + ' km/l'],
           ['Category', car.category], ['Color', car.color], ['Seats', car.seats],
           ['Safety Rating', car.safetyRating + '★ / 5★']].map(([k,v]) => `
          <div class="spec-item"><span class="spec-key">${k}</span><span class="spec-val">${v}</span></div>`).join('')}
      </div>
    </div>

    <div id="tab-features" class="tab-content">
      <div class="features-list">
        ${car.features.map(f => `<span class="feature-chip">✓ ${f}</span>`).join('')}
      </div>
      <div class="pros-cons">
        <div class="pros">
          <h4>✅ Pros</h4>
          ${car.pros.map(p => `<p>• ${p}</p>`).join('')}
        </div>
        <div class="cons">
          <h4>❌ Cons</h4>
          ${car.cons.map(c => `<p>• ${c}</p>`).join('')}
        </div>
      </div>
    </div>

    <div id="tab-insights" class="tab-content">
      <div class="insights-container">
        <div class="insight-card">
          <h4>🧠 AI Recommendation</h4>
          <p>${generateAIInsight(car)}</p>
        </div>
        <div class="insight-card">
          <h4>📈 Investment Analysis</h4>
          <p>Based on current depreciation of <strong>${car.depreciationRate}%/year</strong>, this car will be worth approximately <strong>${fmt.price(Math.round(car.price * Math.pow(1 - car.depreciationRate / 100, 3)))}</strong> in 3 years. ${car.depreciationRate <= 13 ? 'Low depreciation makes it a <strong>smart investment</strong>.' : 'Consider this when planning resale.'}</p>
        </div>
        <div class="insight-card">
          <h4>🎯 Best For</h4>
          <p>${generateBestFor(car)}</p>
        </div>
        <div class="insight-premium-gate">
          <div class="gate-content">
            <span>🔒</span>
            <p><strong>Unlock Full AI Report</strong> — Market timing, competitor analysis, negotiation tips, hidden costs</p>
            <button class="btn btn-primary" onclick="navigate('pricing')">Upgrade to Pro — ₹499/mo</button>
          </div>
        </div>
      </div>
    </div>

    <div id="tab-cost" class="tab-content">
      <div class="cost-breakdown">
        <h4>5-Year Total Cost of Ownership</h4>
        <div class="cost-items">
          ${[['Purchase Price', car.price], ['Maintenance (5yr)', car.maintenanceCostPerYear * 5],
             ['Insurance (5yr)', car.insuranceCostPerYear * 5], ['Fuel/Energy Est. (5yr)', car.fuel === 'Electric' ? 75000 : Math.round(car.price * 0.12)]].map(([k,v]) => `
          <div class="cost-item">
            <span class="cost-key">${k}</span>
            <div class="cost-bar-wrap"><div class="cost-bar" style="width:${Math.min(100, v/car.totalCostOfOwnership5yr*100)}%"></div></div>
            <span class="cost-val">${fmt.price(v)}</span>
          </div>`).join('')}
          <div class="cost-total"><span>Total 5-Year Cost</span><span>${fmt.price(car.totalCostOfOwnership5yr)}</span></div>
        </div>
      </div>
    </div>
  </div>

    <div id="tab-emi" class="tab-content">
      <div class="emi-calc">
        <h4 style="margin-bottom:20px">📊 EMI Calculator</h4>
        <div class="emi-rows">
          <div class="emi-row">
            <div class="emi-label-row"><label>Loan Amount</label><span id="emi-amount-val" class="emi-val-display">${fmt.price(Math.round(car.price*0.8))}</span></div>
            <input type="range" class="emi-slider" id="emi-amount" min="${Math.round(car.price*0.1)}" max="${car.price}" step="10000" value="${Math.round(car.price*0.8)}" oninput="calcEMI(${car.price})">
            <div class="emi-range-labels"><span>${fmt.price(Math.round(car.price*0.1))}</span><span>${fmt.price(car.price)}</span></div>
          </div>
          <div class="emi-row">
            <div class="emi-label-row"><label>Interest Rate</label><span id="emi-rate-val" class="emi-val-display">8.5%</span></div>
            <input type="range" class="emi-slider" id="emi-rate" min="6" max="18" step="0.5" value="8.5" oninput="calcEMI(${car.price})">
            <div class="emi-range-labels"><span>6%</span><span>18%</span></div>
          </div>
          <div class="emi-row">
            <div class="emi-label-row"><label>Tenure</label><span id="emi-tenure-val" class="emi-val-display">60 months</span></div>
            <input type="range" class="emi-slider" id="emi-tenure" min="12" max="84" step="12" value="60" oninput="calcEMI(${car.price})">
            <div class="emi-range-labels"><span>12 mo</span><span>84 mo</span></div>
          </div>
        </div>
        <div class="emi-results" id="emi-result">
          <div class="emi-result-card"><span class="emi-result-label">Monthly EMI</span><span class="emi-result-val" id="emi-monthly">—</span></div>
          <div class="emi-result-card"><span class="emi-result-label">Total Interest</span><span class="emi-result-val emi-interest" id="emi-totalint">—</span></div>
          <div class="emi-result-card"><span class="emi-result-label">Total Payment</span><span class="emi-result-val" id="emi-totalpay">—</span></div>
          <div class="emi-result-card"><span class="emi-result-label">Down Payment</span><span class="emi-result-val" id="emi-down">—</span></div>
        </div>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-top:12px">* Indicative only. Actual EMI depends on lender terms, credit score, and processing fees.</p>
      </div>
    </div>

  ${simRaw.length ? `<div class="similar-section">
    <h2>Similar Cars</h2>
    <div class="similar-grid">${simRaw.map(carCard).join('')}</div>
  </div>` : ''}`;

  attachCardEvents();
}

function switchTab(tab, btn) {
  qsa('.tab-btn').forEach(b => b.classList.remove('active'));
  qsa('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  $(`tab-${tab}`).classList.add('active');
  if (tab === 'emi') {
    const amtEl = $('emi-amount');
    if (amtEl) calcEMI(+amtEl.max);
  }
}

function calcEMI(carPrice) {
  const amtEl = $('emi-amount'), rateEl = $('emi-rate'), tenureEl = $('emi-tenure');
  if (!amtEl) return;
  const P = +amtEl.value;
  const r = +rateEl.value / 100 / 12;
  const n = +tenureEl.value;
  const down = carPrice - P;
  const emi = r === 0 ? P / n : P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  const totalPay = emi * n;
  const totalInt = totalPay - P;
  $('emi-amount-val').textContent = fmt.price(P);
  $('emi-rate-val').textContent = rateEl.value + '%';
  $('emi-tenure-val').textContent = n + ' months';
  $('emi-monthly').textContent = fmt.price(Math.round(emi));
  $('emi-totalint').textContent = fmt.price(Math.round(totalInt));
  $('emi-totalpay').textContent = fmt.price(Math.round(totalPay));
  $('emi-down').textContent = fmt.price(Math.round(down));
}

function toggleWishDetail(id, btn) {
  const idx = state.wishlist.indexOf(id);
  if (idx === -1) { state.wishlist.push(id); toast('Added to wishlist ♥', 'success'); btn.classList.add('wished'); }
  else { state.wishlist.splice(idx, 1); toast('Removed from wishlist', 'info'); btn.classList.remove('wished'); }
  localStorage.setItem('wishlist', JSON.stringify(state.wishlist));
}

function generateAIInsight(car) {
  if (car.discontinued) {
    return `The ${car.make} ${car.model} was <strong>discontinued in India</strong>. If you're set on this model, the used-car market (especially 2020–2022 examples) may offer good value, but factor in higher parts costs and limited service support from the manufacturer.`;
  }
  const insights = {
    'rising': `The ${car.make} ${car.model} is showing <strong>strong market momentum</strong> with a demand index of ${car.demandIndex}/100. Now is an ideal time to buy before prices adjust upward.`,
    'stable': `The ${car.make} ${car.model} holds a <strong>stable market position</strong>. Good availability means you have negotiating power — expect 2-5% off the listed price.`,
    'falling': `Market data suggests <strong>softening demand</strong> for this model. Consider waiting 1-2 months for better deals or negotiating aggressively.`
  };
  return insights[car.marketTrend] || 'Insufficient data for analysis.';
}

function generateBestFor(car) {
  const profiles = {
    'Sedan': 'Business professionals, daily commuters, and families who prioritize comfort and fuel efficiency.',
    'SUV': 'Families, adventure seekers, and those who need ground clearance for varied terrain.',
    'Hatchback': 'Urban dwellers, first-time buyers, and budget-conscious buyers who want low running costs.',
    'Electric SUV': 'Eco-conscious buyers, tech enthusiasts, and those with home charging access.',
    'Luxury Sedan': 'Executives, premium experience seekers, and those who value brand prestige.'
  };
  return profiles[car.category] || 'Versatile choice for most buyers.';
}

/* ─── ANALYTICS ─────────────────────────────────────────────── */
function renderAnalytics() {
  renderMarketChart();
  renderCategoryChart();
  renderFuelChart();
  renderTopCars();
  renderMarketInsights();
}

function renderMarketChart() {
  const data = MARKET_DATA.monthlyTrends;
  const max = Math.max(...data.map(d => d.sales));
  $('market-chart').innerHTML = `
  <div class="bar-chart">
    ${data.map(d => `
    <div class="bar-col">
      <div class="bar-fill" style="height:${(d.sales/max*100).toFixed(1)}%" title="${d.month}: ${fmt.num(d.sales)}"></div>
      <span class="bar-label">${d.month}</span>
    </div>`).join('')}
  </div>
  <p class="chart-note">Monthly car sales volume (India) 2024</p>`;
}

function renderCategoryChart() {
  const cats = ['SUV', 'Sedan', 'Hatchback', 'Electric SUV', 'Luxury Sedan'];
  const vol = MARKET_DATA.monthlySearchVolume;
  const total = Object.values(vol).reduce((a, b) => a + b, 0);
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
  $('category-chart').innerHTML = `
  <div class="donut-chart">
    <svg viewBox="0 0 200 200" width="200" height="200">
      ${buildDonutSlices(cats.map((c, i) => ({ label: c, value: vol[c], color: colors[i] })))}
      <text x="100" y="96" text-anchor="middle" class="donut-center-label">Search</text>
      <text x="100" y="112" text-anchor="middle" class="donut-center-label">Volume</text>
    </svg>
  </div>
  <div class="donut-legend">
    ${cats.map((c, i) => `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${c}: ${fmt.pct(Math.round(vol[c]/total*100))}</div>`).join('')}
  </div>`;
}

function buildDonutSlices(items) {
  const total = items.reduce((s, i) => s + i.value, 0);
  let offset = 0;
  const r = 70, cx = 100, cy = 100, circumference = 2 * Math.PI * r;
  return items.map(item => {
    const pct = item.value / total;
    const dash = pct * circumference;
    const slice = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${item.color}" stroke-width="30"
      stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset * circumference}" transform="rotate(-90 ${cx} ${cy})">
      <title>${item.label}: ${fmt.num(item.value)}</title></circle>`;
    offset += pct;
    return slice;
  }).join('');
}

function renderFuelChart() {
  const data = MARKET_DATA.fuelPreference;
  const colors = { Petrol: '#f59e0b', Diesel: '#6b7280', Electric: '#10b981', Hybrid: '#3b82f6' };
  $('fuel-chart').innerHTML = Object.entries(data).map(([k, v]) => `
  <div class="hbar-row">
    <span class="hbar-label">${k}</span>
    <div class="hbar-track"><div class="hbar-fill" style="width:${v}%;background:${colors[k]}"></div></div>
    <span class="hbar-val">${v}%</span>
  </div>`).join('');
}

function renderTopCars() {
  const sorted = [...CAR_DATABASE].sort((a, b) => b.analyticsScore - a.analyticsScore);
  $('top-cars-list').innerHTML = sorted.map((car, i) => `
  <div class="rank-item" onclick="navigate('detail',{id:${car.id}})">
    <span class="rank-num">#${i + 1}</span>
    <div class="rank-info">
      <span class="rank-name">${car.make} ${car.model}</span>
      <span class="rank-sub">${car.variant} · ${fmt.price(car.price)}</span>
    </div>
    <div class="score-badge ${car.analyticsScore >= 85 ? 'score-green' : 'score-blue'}">${car.analyticsScore}</div>
  </div>`).join('');
}

function renderMarketInsights() {
  $('market-insights').innerHTML = `
  <div class="insight-stat ${MARKET_DATA.evAdoptionGrowth > 0 ? 'positive' : 'negative'}">
    <span class="is-icon">⚡</span>
    <div><strong>EV Adoption</strong><p>+${MARKET_DATA.evAdoptionGrowth}% YoY growth in electric vehicle interest</p></div>
  </div>
  <div class="insight-stat positive">
    <span class="is-icon">🚙</span>
    <div><strong>SUV Dominance</strong><p>SUV segment grew ${MARKET_DATA.suvGrowth}% — highest demand category</p></div>
  </div>
  <div class="insight-stat negative">
    <span class="is-icon">🚗</span>
    <div><strong>Sedan Decline</strong><p>Sedan market contracted ${Math.abs(MARKET_DATA.sedanDecline)}% as SUVs take share</p></div>
  </div>
  <div class="insight-stat positive">
    <span class="is-icon">🔧</span>
    <div><strong>Top Features Wanted</strong><p>${MARKET_DATA.topSearchedFeatures.join(', ')}</p></div>
  </div>`;
}

/* ─── COMPARE ───────────────────────────────────────────────── */
function renderCompare() {
  if (state.compareList.length < 2) {
    $('compare-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚖️</div><p>Select 2–3 cars from listings to compare.</p><button class="btn btn-primary" onclick="navigate('listings')">Browse Cars</button></div>`;
    return;
  }
  const cars = state.compareList.map(id => CAR_DATABASE.find(c => c.id === id));
  const cols = cars.length;
  const rows = [
    ['Price', c => fmt.price(c.price)],
    ['Category', c => c.category],
    ['Engine', c => c.engine],
    ['Power', c => c.power],
    ['Torque', c => c.torque],
    ['Fuel', c => c.fuel],
    ['Mileage', c => c.fuel === 'Electric' ? 'N/A' : c.mileage + ' km/l'],
    ['Transmission', c => c.transmission],
    ['Safety Rating', c => c.safetyRating + '★ / 5★'],
    ['Rating', c => c.rating + ' / 5'],
    ['Analytics Score', c => c.analyticsScore + ' / 100'],
    ['Depreciation/yr', c => c.depreciationRate + '%'],
    ['Annual Maintenance', c => fmt.price(c.maintenanceCostPerYear)],
    ['Annual Insurance', c => fmt.price(c.insuranceCostPerYear)],
    ['5yr Total Cost', c => fmt.price(c.totalCostOfOwnership5yr)],
    ['Market Trend', c => c.marketTrend],
    ['Demand Index', c => c.demandIndex + '/100'],
  ];

  $('compare-content').innerHTML = `
  <div class="compare-table-wrap">
  <table class="compare-table">
    <thead>
      <tr>
        <th>Feature</th>
        ${cars.map(c => `<th><div class="ct-header"><img src="${c.image}" alt="${c.make}" onerror="imgFallback(this,'${c.pressImageUrl||''}','${c.make}')" /><p>${c.make} ${c.model}</p><small>${c.variant}</small><button class="remove-compare" onclick="removeCompare(${c.id})">✕</button></div></th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.map(([label, fn]) => {
        const vals = cars.map(fn);
        const numVals = vals.map(v => parseFloat(v.replace(/[^\d.]/g, '')));
        const allNum = numVals.every(v => !isNaN(v));
        return `<tr>
          <td class="row-label">${label}</td>
          ${vals.map((v, i) => {
            let cls = '';
            if (allNum && cols > 1) {
              const isBest = numVals[i] === Math.max(...numVals);
              const isWorst = numVals[i] === Math.min(...numVals);
              const higherBetter = !['Depreciation/yr', 'Annual Maintenance', 'Annual Insurance', '5yr Total Cost'].includes(label);
              if (higherBetter && isBest) cls = 'cell-best';
              else if (!higherBetter && isWorst) cls = 'cell-best';
              else if (higherBetter && isWorst) cls = 'cell-worst';
              else if (!higherBetter && isBest) cls = 'cell-worst';
            }
            return `<td class="${cls}">${v}</td>`;
          }).join('')}
        </tr>`;
      }).join('')}
    </tbody>
  </table>
  </div>`;
}

function removeCompare(id) {
  state.compareList = state.compareList.filter(i => i !== id);
  updateCompareBar();
  renderCompare();
}

/* ─── PRICING ───────────────────────────────────────────────── */
function renderPricing() {
  $('pricing-cards').innerHTML = SUBSCRIPTION_PLANS.map(plan => `
  <div class="pricing-card ${plan.popular ? 'pricing-popular' : ''}">
    ${plan.popular ? '<span class="popular-badge">Most Popular</span>' : ''}
    <div class="plan-icon" style="color:${plan.color}">●</div>
    <h3 class="plan-name">${plan.name}</h3>
    <div class="plan-price">
      ${plan.price === 0 ? '<span class="price-amount">Free</span>' : `<span class="price-amount">₹${plan.price}</span><span class="price-cycle">/${plan.billingCycle}</span>`}
    </div>
    <ul class="plan-features">
      ${plan.features.map(f => `<li>✓ ${f}</li>`).join('')}
    </ul>
    <button class="btn ${plan.popular ? 'btn-primary' : 'btn-outline'} btn-full"
      onclick="selectPlan('${plan.id}')">
      ${state.currentPlan === plan.id ? '✓ Current Plan' : plan.price === 0 ? 'Get Started' : 'Upgrade Now'}
    </button>
  </div>`).join('');
}

function selectPlan(planId) {
  if (planId === 'basic') { state.currentPlan = 'basic'; toast('You are on Free plan', 'info'); }
  else { toast(`Redirecting to payment for ${planId} plan...`, 'success'); setTimeout(() => toast('Payment gateway integration coming soon!', 'info'), 1500); }
  renderPricing();
}

/* ─── SEARCH ────────────────────────────────────────────────── */
function setupSearch() {
  const inp = $('search-input');
  let debounce;
  inp.addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      if (state.currentPage === 'listings') applyFilters();
      else if (state.searchQuery.length > 1) navigate('listings');
    }, 300);
  });
}

/* ─── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupSearch();
  updateCompareBar();

  // Nav
  qsa('.nav-link').forEach(l => l.addEventListener('click', e => {
    e.preventDefault();
    navigate(l.dataset.page);
  }));

  // Filter buttons
  qsa('.filter-btn').forEach(b => b.addEventListener('click', e => {
    const group = b.dataset.group;
    qsa(`.filter-btn[data-group="${group}"]`).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    if (group === 'category') state.filters.category = b.dataset.value;
    else if (group === 'fuel') state.filters.fuel = b.dataset.value;
    applyFilters();
  }));

  // Sort
  const sortSel = $('sort-select');
  if (sortSel) sortSel.addEventListener('change', e => { state.filters.sort = e.target.value; applyFilters(); });

  // Compare bar button
  $('go-compare-btn').addEventListener('click', () => navigate('compare'));
  $('clear-compare-btn').addEventListener('click', () => { state.compareList = []; updateCompareBar(); renderListings(); });

  // CTA
  qsa('[data-nav]').forEach(el => el.addEventListener('click', e => navigate(e.currentTarget.dataset.nav)));

  navigate('home');
});
