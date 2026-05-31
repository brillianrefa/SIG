/**
 * SiGaRis – Sistem Informasi Geospasial Risiko Bencana Jawa Timur
 * script.js – Main Application Logic
 *
 * Modules:
 *  1. Config & State
 *  2. Map Initialization
 *  3. GeoJSON Loader & Renderer
 *  4. Risk Color Mapping
 *  5. Popup Builder
 *  6. Filter Logic
 *  7. Search Logic
 *  8. Dashboard Stats
 *  9. Top Regions List
 * 10. Insight Generator
 * 11. UI Utilities (sidebar, modal, clock)
 */

/* ══════════════════════════════════════════
   1. CONFIG & STATE
══════════════════════════════════════════ */
const CONFIG = {
  /** Path to the main city/regency boundary file */
  geojsonPath: 'data/jatim_kabkota_final.geojson',

  /** Initial map center: East Java centroid */
  mapCenter: [-7.5360, 112.2384],
  mapZoom: 8,

  /** Risk level definitions */
  riskColors: {
    high: '#D64545',
    medium: '#F2C94C',
    low: '#27AE60',
  },

  /** Risk level display names (Indonesian) */
  riskLabels: {
    high: 'Risiko Tinggi',
    medium: 'Risiko Sedang',
    low: 'Risiko Rendah',
  },
};

/** Human-friendly disaster type labels (GeoJSON value → display) */
const DISASTER_LABELS = {
  BANJIR: 'Banjir',
  'CUACA EKSTREM': 'Cuaca Ekstrem',
  'TANAH LONGSOR': 'Tanah Longsor',
  KEKERINGAN: 'Kekeringan',
  GEMPABUMI: 'Gempa Bumi',
  'ERUPSI GUNUNG API': 'Gunung Meletus',
};

/** Normalise a GeoJSON disaster_type value for display */
function disasterLabel(raw) {
  return DISASTER_LABELS[raw] || raw;
}

/**
 * Application state – single source of truth.
 */
const STATE = {
  /** Raw GeoJSON FeatureCollection loaded from file */
  geojsonData: null,

  /** Active disaster type filter */
  activeFilter: 'Semua',

  /** Leaflet map instance */
  map: null,

  /** Leaflet GeoJSON layer currently on map */
  geojsonLayer: null,

  /** Map from region name → Leaflet layer (for search zoom) */
  layerMap: {},
};


/* ══════════════════════════════════════════
   2. MAP INITIALIZATION
══════════════════════════════════════════ */
/**
 * Creates and configures the Leaflet map.
 */
function initMap() {
  STATE.map = L.map('map', {
    center: CONFIG.mapCenter,
    zoom: CONFIG.mapZoom,
    zoomControl: false,        // We'll place zoom control manually
    attributionControl: true,
  });

  /* ── OpenStreetMap basemap ── */
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(STATE.map);

  /* ── Place zoom control at top-right ── */
  L.control.zoom({ position: 'topright' }).addTo(STATE.map);

  /* ── Close search dropdown when clicking map ── */
  STATE.map.on('click', () => hideSearchDropdown());
}


/* ══════════════════════════════════════════
   3. GEOJSON LOADER & RENDERER
══════════════════════════════════════════ */
/**
 * Fetches GeoJSON from disk and bootstraps the app.
 */
async function loadGeoJSON() {
  try {
    document.getElementById('mapLoading').classList.remove('hidden');

    const response = await fetch(CONFIG.geojsonPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    STATE.geojsonData = await response.json();

    // Hide loading screen
    document.getElementById('mapLoading').classList.add('hidden');

    // Initial render with all data
    renderGeoJSON(STATE.geojsonData.features);
    
    // Update dashboard using affected features
    const affected = STATE.geojsonData.features.filter(f => f.properties.risk_level !== 'safe');
    updateDashboard(affected);
    updateTopRegions(affected);
    updateInsight(affected);

  } catch (err) {
    console.error('Failed to load GeoJSON:', err);
    const loading = document.getElementById('mapLoading');
    loading.innerHTML = `
      <div style="text-align:center;color:#D64545;padding:24px">
        <div style="font-size:32px">⚠️</div>
        <p style="margin-top:8px;font-weight:600">Gagal memuat data peta</p>
        <p style="font-size:12px;margin-top:4px;color:#666">Pastikan file <code>${CONFIG.geojsonPath}</code> tersedia</p>
        <p style="font-size:11px;margin-top:4px;color:#999">${err.message}</p>
      </div>`;
  }
}

/**
 * Renders GeoJSON features on the map.
 * Removes the old layer first, then adds a fresh one.
 *
 * @param {Array} features - Array of GeoJSON Feature objects
 */
function renderGeoJSON(features) {
  // Remove previous layer if it exists
  if (STATE.geojsonLayer) {
    STATE.map.removeLayer(STATE.geojsonLayer);
    STATE.geojsonLayer = null;
    STATE.layerMap = {};
  }

  // Build a synthetic FeatureCollection from the provided features
  const collection = {
    type: 'FeatureCollection',
    features: features,
  };

  STATE.geojsonLayer = L.geoJSON(collection, {
    style: styleFeature,
    onEachFeature: onEachFeature,
  }).addTo(STATE.map);
}


/* ══════════════════════════════════════════
   4. RISK COLOR MAPPING
══════════════════════════════════════════ */
/**
 * Returns the fill color string for a given risk_level.
 *
 * @param {string} riskLevel - 'high' | 'medium' | 'low'
 * @returns {string} hex color
 */
function getRiskColor(riskLevel) {
  return CONFIG.riskColors[riskLevel] || '#AAAAAA';
}

/**
 * Leaflet style function – called for each feature.
 *
 * @param {Object} feature - GeoJSON feature
 * @returns {Object} Leaflet PathOptions
 */
function styleFeature(feature) {
  let risk = feature.properties.risk_level;

  // Apply filter dynamically
  if (STATE.activeFilter !== 'Semua') {
    const reqType = FILTER_MAP[STATE.activeFilter];
    if (feature.properties.disaster_type !== reqType) {
      risk = 'safe';
    }
  }

  if (risk === 'safe' || !risk) {
    return {
      fillOpacity: 0,
      color: '#888888', // Thin grey border for safe villages
      weight: 0.5,
      opacity: 0.5,
    };
  }

  return {
    fillColor: getRiskColor(risk),
    fillOpacity: 0.75,
    color: '#444444',
    weight: 0.8,
    opacity: 0.8,
  };
}

/**
 * Returns highlight style on hover.
 */
function styleHighlight(feature) {
  let risk = feature.properties.risk_level;
  if (STATE.activeFilter !== 'Semua' && feature.properties.disaster_type !== FILTER_MAP[STATE.activeFilter]) {
    risk = 'safe';
  }

  if (risk === 'safe' || !risk) {
    return {
      fillOpacity: 0.1,
      color: '#555555',
      weight: 1,
      opacity: 0.8,
    };
  }

  return {
    fillColor: getRiskColor(risk),
    fillOpacity: 0.9,
    color: '#FFFFFF',
    weight: 2,
    opacity: 1,
  };
}


/* ══════════════════════════════════════════
   5. POPUP BUILDER & EVENT HANDLERS
══════════════════════════════════════════ */
/**
 * Formats a damage number as Indonesian Rupiah (abbreviated).
 *
 * @param {number} amount
 * @returns {string}
 */
function formatRupiah(amount) {
  if (amount >= 1_000_000_000) {
    return `Rp ${(amount / 1_000_000_000).toFixed(1)} M`;
  }
  if (amount >= 1_000_000) {
    return `Rp ${(amount / 1_000_000).toFixed(0)} Jt`;
  }
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

/**
 * Builds the HTML string for a Leaflet popup.
 *
 * @param {Object} props - GeoJSON feature properties
 * @returns {string} HTML
 */
function buildPopupHTML(props) {
  const risk = props.risk_level;
  const riskLabel = CONFIG.riskLabels[risk] || risk;
  const label = disasterLabel(props.disaster_type);
  return `
    <div class="custom-popup">
      <div class="popup-header ${risk}">
        <div class="popup-risk-label">${riskLabel}</div>
        <div class="popup-name">${props.name}</div>
        <div class="popup-disaster">${label}</div>
      </div>
      <div class="popup-body">
        <div class="popup-stat">
          <div class="popup-stat-val">${props.deaths.toLocaleString('id-ID')}</div>
          <div class="popup-stat-lbl">Korban Jiwa</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-val">${props.injuries.toLocaleString('id-ID')}</div>
          <div class="popup-stat-lbl">Luka-luka</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-val">${formatRupiah(props.damage)}</div>
          <div class="popup-stat-lbl">Kerugian Materi</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-val">${riskLabel}</div>
          <div class="popup-stat-lbl">Tingkat Risiko</div>
        </div>
      </div>
    </div>`;
}

/**
 * Opens the bottom modal with region details (used on mobile/click).
 *
 * @param {Object} props
 */
function openRegionModal(props) {
  const risk = props.risk_level;
  const overlay = document.getElementById('regionModalOverlay');
  const header = document.getElementById('modalHeader');

  // Set header color class
  header.className = 'modal-header ' + risk;
  document.getElementById('modalRiskBadge').textContent = CONFIG.riskLabels[risk] || risk;
  document.getElementById('modalName').textContent = props.name;
  document.getElementById('modalDisaster').textContent = disasterLabel(props.disaster_type);
  document.getElementById('modalDeaths').textContent = props.deaths.toLocaleString('id-ID');
  document.getElementById('modalInjuries').textContent = props.injuries.toLocaleString('id-ID');
  document.getElementById('modalDamage').textContent = formatRupiah(props.damage);
  document.getElementById('modalRisk').textContent = CONFIG.riskLabels[risk] || risk;

  overlay.classList.add('show');
}

/**
 * Aggregates all disaster records for a given region name.
 * Returns a summary object for the popup/modal.
 */
function getRegionSummary(regionName) {
  const features = STATE.geojsonData.features.filter(
    f => f.properties.name === regionName
  );

  const totalDeaths = features.reduce((s, f) => s + f.properties.deaths, 0);
  const totalInjuries = features.reduce((s, f) => s + f.properties.injuries, 0);
  const totalDamage = features.reduce((s, f) => s + f.properties.damage, 0);

  const riskOrder = { high: 3, medium: 2, low: 1 };
  let worstRisk = 'low';
  features.forEach(f => {
    if (riskOrder[f.properties.risk_level] > riskOrder[worstRisk]) {
      worstRisk = f.properties.risk_level;
    }
  });

  const types = [...new Set(features.map(f => f.properties.disaster_type))];

  return {
    name: regionName,
    risk_level: worstRisk,
    deaths: totalDeaths,
    injuries: totalInjuries,
    damage: totalDamage,
    disasterTypes: types,
    recordCount: features.length,
  };
}

/**
 * Builds an aggregated popup showing all disasters for a region.
 */
function buildAggregatedPopupHTML(s) {
  const riskLabel = CONFIG.riskLabels[s.risk_level] || s.risk_level;
  const typeList = s.disasterTypes
    .map(t => disasterLabel(t))
    .join('<br>');

  return `
    <div class="custom-popup">
      <div class="popup-header ${s.risk_level}">
        <div class="popup-risk-label">${riskLabel} · ${s.recordCount} Bencana</div>
        <div class="popup-name">${s.name}</div>
        <div class="popup-disaster">${typeList}</div>
      </div>
      <div class="popup-body">
        <div class="popup-stat">
          <div class="popup-stat-val">${s.deaths.toLocaleString('id-ID')}</div>
          <div class="popup-stat-lbl">Korban Jiwa</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-val">${s.injuries.toLocaleString('id-ID')}</div>
          <div class="popup-stat-lbl">Luka-luka</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-val">${formatRupiah(s.damage)}</div>
          <div class="popup-stat-lbl">Total Kerugian</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-val">${riskLabel}</div>
          <div class="popup-stat-lbl">Risiko Tertinggi</div>
        </div>
      </div>
    </div>`;
}

/**
 * Opens the bottom modal with aggregated region data.
 */
function openAggregatedModal(s) {
  const risk = s.risk_level;
  const overlay = document.getElementById('regionModalOverlay');
  const header = document.getElementById('modalHeader');

  header.className = 'modal-header ' + risk;
  document.getElementById('modalRiskBadge').textContent =
    CONFIG.riskLabels[risk] + ' · ' + s.recordCount + ' Bencana';
  document.getElementById('modalName').textContent = s.name;
  document.getElementById('modalDisaster').textContent = s.disasterTypes
    .map(t => disasterLabel(t))
    .join('  ·  ');
  document.getElementById('modalDeaths').textContent = s.deaths.toLocaleString('id-ID');
  document.getElementById('modalInjuries').textContent = s.injuries.toLocaleString('id-ID');
  document.getElementById('modalDamage').textContent = formatRupiah(s.damage);
  document.getElementById('modalRisk').textContent = CONFIG.riskLabels[risk];

  overlay.classList.add('show');
}

/**
 * Attaches hover + click events to each GeoJSON feature.
 *
 * @param {Object} feature - GeoJSON feature
 * @param {Object} layer   - Leaflet layer
 */
function onEachFeature(feature, layer) {
  const props = feature.properties;

  // Store reference for search zoom (keyed by name for quick lookup)
  if (!STATE.layerMap[props.name]) {
    STATE.layerMap[props.name] = [];
  }
  STATE.layerMap[props.name].push(layer);

  // ── Hover: highlight + rich tooltip ──
  layer.on('mouseover', function (e) {
    this.setStyle(styleHighlight(feature));
    
    // Do not show tooltip for safe villages
    let isSafe = props.risk_level === 'safe';
    if (STATE.activeFilter !== 'Semua' && props.disaster_type !== FILTER_MAP[STATE.activeFilter]) {
      isSafe = true;
    }

    if (!isSafe) {
      this.bringToFront();
      const label = disasterLabel(props.disaster_type);
      const riskLabel = CONFIG.riskLabels[props.risk_level];
      const riskDot = getRiskColor(props.risk_level);

      const tip = `
        <div class="tt-card">
          <div class="tt-name">${props.name}</div>
          <div class="tt-disaster">${label}</div>
          <div class="tt-risk">
            <span class="tt-dot" style="background:${riskDot}"></span>${riskLabel}
          </div>
          <div class="tt-meta">
            ${props.deaths.toLocaleString('id-ID')} korban jiwa  ·  ${formatRupiah(props.damage)} kerugian
          </div>
        </div>`;

      this.bindTooltip(tip, {
        permanent: false,
        direction: 'top',
        className: 'map-tooltip',
        offset: [0, -10],
        opacity: 0.96,
      }).openTooltip(e.latlng);
    }
  });

  // ── Mouse out: reset style ──
  layer.on('mouseout', function () {
    STATE.geojsonLayer.resetStyle(this);
    this.closeTooltip();
    this.unbindTooltip();
  });

  // ── Click: popup + modal (aggregated if "Semua" filter) ──
  layer.on('click', function (e) {
    let isSafe = props.risk_level === 'safe';
    if (STATE.activeFilter !== 'Semua' && props.disaster_type !== FILTER_MAP[STATE.activeFilter]) {
      isSafe = true;
    }
    if (isSafe) return; // Do not open popup for safe villages

    if (STATE.activeFilter === 'Semua') {
      const summary = getRegionSummary(props.name);
      L.popup({ maxWidth: 320, offset: [0, -10] })
        .setLatLng(e.latlng)
        .setContent(buildAggregatedPopupHTML(summary))
        .openOn(STATE.map);
      openAggregatedModal(summary);
    } else {
      L.popup({ maxWidth: 280, offset: [0, -10] })
        .setLatLng(e.latlng)
        .setContent(buildPopupHTML(props))
        .openOn(STATE.map);
      openRegionModal(props);
    }
  });
}


/* ══════════════════════════════════════════
   6. FILTER LOGIC
══════════════════════════════════════════ */
/**
 * Filters features by disaster_type and re-renders the map + stats.
 *
 * @param {string} filterValue - disaster type or 'Semua'
 */
/**
 * Maps filter button value → actual disaster_type in GeoJSON.
 */
const FILTER_MAP = {
  'Banjir': 'Banjir',
  'Cuaca Ekstrem': 'Cuaca Ekstrem',
  'Tanah Longsor': 'Tanah Longsor',
  'Kekeringan': 'Kekeringan',
  'Gempa Bumi': 'Gempa Bumi',
  'Gunung Meletus': 'Gunung Meletus',
};

function applyFilter(filterValue) {
  STATE.activeFilter = filterValue;

  // Re-style existing layer efficiently instead of re-rendering 8500 polygons
  STATE.geojsonLayer.setStyle(styleFeature);

  // Update dashboard and stats with only affected/matching features
  const affectedFeatures = STATE.geojsonData.features.filter(f => {
    if (f.properties.risk_level === 'safe') return false;
    if (filterValue === 'Semua') return true;
    return f.properties.disaster_type === FILTER_MAP[filterValue];
  });

  updateDashboard(affectedFeatures);
  updateTopRegions(affectedFeatures);
  updateInsight(affectedFeatures);

  // Update topbar badge
  document.getElementById('activeBadge').textContent =
    filterValue === 'Semua' ? 'Semua Bencana' : filterValue;
}

/**
 * Sets up click listeners on filter buttons.
 */
function initFilterButtons() {
  const group = document.getElementById('filterGroup');
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    // Update active state
    group.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    applyFilter(btn.dataset.value);
  });
}


/* ══════════════════════════════════════════
   7. SEARCH LOGIC
══════════════════════════════════════════ */
/**
 * Filters region names matching the query and shows a dropdown.
 *
 * @param {string} query - raw user input
 */
function handleSearch(query) {
  const dropdown = document.getElementById('searchDropdown');
  if (!query.trim() || !STATE.geojsonData) {
    hideSearchDropdown();
    return;
  }

  const q = query.toLowerCase();
  const seen = new Set();
  const matches = STATE.geojsonData.features
    .filter(f => {
      const name = f.properties.name.toLowerCase();
      if (seen.has(name) || !name.includes(q)) return false;
      seen.add(name);
      return true;
    })
    .slice(0, 6);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div class="search-result-item" style="color:#999">Tidak ditemukan</div>`;
    dropdown.classList.add('show');
    return;
  }

  dropdown.innerHTML = matches.map(f => {
    const p = f.properties;
    const color = getRiskColor(p.risk_level);
    const regionSummary = getRegionSummary(p.name);
    const typePreview = regionSummary.disasterTypes
      .slice(0, 3)
      .map(t => disasterLabel(t))
      .join(', ');
    const more = regionSummary.disasterTypes.length > 3
      ? ` +${regionSummary.disasterTypes.length - 3}`
      : '';
    return `
      <div class="search-result-item" data-name="${p.name}">
        <span class="search-result-dot" style="background:${color}"></span>
        <span class="search-result-name">${p.name}</span>
        <span class="search-result-type">${typePreview}${more}</span>
      </div>`;
  }).join('');

  dropdown.classList.add('show');
}

/**
 * Zooms the map to a region by name and opens its popup.
 *
 * @param {string} name - exact region name
 */
function zoomToRegion(name) {
  const feature = STATE.geojsonData.features.find(f => f.properties.name === name);
  if (!feature) return;

  const layers = STATE.layerMap[name];
  if (!layers || !layers.length) return;

  const firstLayer = layers[0];

  // Close search UI
  document.getElementById('searchInput').value = name;
  hideSearchDropdown();

  // Pan/zoom to region bounds
  STATE.map.fitBounds(firstLayer.getBounds(), { padding: [40, 40] });

  // Highlight all layers for this region briefly
  layers.forEach(l => l.setStyle(styleHighlight(feature.properties.risk_level)));
  setTimeout(() => layers.forEach(l => STATE.geojsonLayer.resetStyle(l)), 2000);

  // Open popup at centroid (aggregated if "Semua" filter)
  const center = firstLayer.getBounds().getCenter();
  if (STATE.activeFilter === 'Semua') {
    const summary = getRegionSummary(name);
    L.popup({ maxWidth: 320 })
      .setLatLng(center)
      .setContent(buildAggregatedPopupHTML(summary))
      .openOn(STATE.map);
    openAggregatedModal(summary);
  } else {
    L.popup({ maxWidth: 280 })
      .setLatLng(center)
      .setContent(buildPopupHTML(feature.properties))
      .openOn(STATE.map);
    openRegionModal(feature.properties);
  }
}

/** Hides the autocomplete dropdown */
function hideSearchDropdown() {
  const dd = document.getElementById('searchDropdown');
  dd.classList.remove('show');
}

/** Initializes search input and dropdown listeners */
function initSearch() {
  const input = document.getElementById('searchInput');
  const dropdown = document.getElementById('searchDropdown');

  input.addEventListener('input', () => handleSearch(input.value));

  // Delegate click on dropdown items
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item && item.dataset.name) {
      zoomToRegion(item.dataset.name);
    }
  });

  // Hide dropdown on Escape
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSearchDropdown();
  });

  // Hide on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      hideSearchDropdown();
    }
  });
}


/* ══════════════════════════════════════════
   8. DASHBOARD STATS
══════════════════════════════════════════ */
/**
 * Animates a number counter from 0 to target.
 *
 * @param {HTMLElement} el
 * @param {number}      target
 * @param {string}      [prefix='']
 * @param {string}      [suffix='']
 * @param {boolean}     [isRupiah=false]
 */
function animateCount(el, target, prefix = '', suffix = '', isRupiah = false) {
  const duration = 700;
  const start = performance.now();

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out
    const ease = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(ease * target);

    if (isRupiah) {
      el.textContent = formatRupiah(value);
    } else {
      el.textContent = prefix + value.toLocaleString('id-ID') + suffix;
    }

    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/**
 * Aggregates stats from visible features and updates the sidebar cards.
 *
 * @param {Array} features
 */
function updateDashboard(features) {
  const totalDisasters = features.length;
  const totalDeaths = features.reduce((s, f) => s + f.properties.deaths, 0);
  const totalInjuries = features.reduce((s, f) => s + f.properties.injuries, 0);
  const totalDamage = features.reduce((s, f) => s + f.properties.damage, 0);

  animateCount(document.getElementById('statDisaster'), totalDisasters);
  animateCount(document.getElementById('statDeaths'), totalDeaths);
  animateCount(document.getElementById('statInjuries'), totalInjuries);
  // Damage uses rupiah formatter directly
  animateCount(document.getElementById('statDamage'), totalDamage, '', '', true);
}


/* ══════════════════════════════════════════
   9. TOP RISK REGIONS
══════════════════════════════════════════ */
/**
 * Risk sort weight: high → 3, medium → 2, low → 1
 */
function riskWeight(r) {
  return { high: 3, medium: 2, low: 1 }[r] || 0;
}

/**
 * Sorts features by risk + deaths + damage, then renders the top-5 list.
 *
 * @param {Array} features
 */
function updateTopRegions(features) {
  const sorted = [...features].sort((a, b) => {
    const rA = riskWeight(a.properties.risk_level);
    const rB = riskWeight(b.properties.risk_level);
    if (rB !== rA) return rB - rA;                        // Risk first
    if (b.properties.deaths !== a.properties.deaths)      // Then deaths
      return b.properties.deaths - a.properties.deaths;
    return b.properties.damage - a.properties.damage;     // Then damage
  });

  const top = sorted.slice(0, 5);
  const container = document.getElementById('topRegions');
  container.innerHTML = '';

  top.forEach((f, i) => {
    const p = f.properties;
    const rankClass = i < 3 ? `rank-${i + 1}` : '';
    const pillClass = `risk-pill-${p.risk_level}`;
    const riskLabel = CONFIG.riskLabels[p.risk_level] || p.risk_level;

    const item = document.createElement('div');
    item.className = 'top-region-item';
    item.style.animationDelay = `${i * 60}ms`;
    item.innerHTML = `
      <div class="top-rank ${rankClass}">${i + 1}</div>
      <div class="top-region-info">
        <div class="top-region-name">${p.name}</div>
        <div class="top-region-meta">${disasterLabel(p.disaster_type)} · ${p.deaths} jiwa</div>
      </div>
      <span class="top-risk-pill ${pillClass}">${riskLabel}</span>`;

    // Click to zoom to this region
    item.addEventListener('click', () => zoomToRegion(p.name));
    container.appendChild(item);
  });
}


/* ══════════════════════════════════════════
   10. INSIGHT GENERATOR
══════════════════════════════════════════ */
/**
 * Auto-generates a human-readable insight sentence from the current data.
 *
 * @param {Array} features
 */
function updateInsight(features) {
  const el = document.getElementById('insightText');

  if (!features.length) {
    el.textContent = 'Tidak ada data untuk filter yang dipilih.';
    return;
  }

  // Find region with most deaths
  const byDeaths = [...features].sort((a, b) => b.properties.deaths - a.properties.deaths)[0];
  // Find disaster type with highest frequency
  const typeCounts = {};
  features.forEach(f => {
    typeCounts[f.properties.disaster_type] = (typeCounts[f.properties.disaster_type] || 0) + 1;
  });
  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  // Count high-risk regions
  const highCount = features.filter(f => f.properties.risk_level === 'high').length;

  const p = byDeaths.properties;
  let text = `Wilayah dengan risiko tertinggi adalah <strong>${p.name}</strong> akibat bencana ${disasterLabel(p.disaster_type)} dengan ${p.deaths} korban jiwa dan kerugian ${formatRupiah(p.damage)}. `;

  if (highCount > 0) {
    text += `Terdapat <strong>${highCount}</strong> wilayah berkategori risiko tinggi. `;
  }

  if (dominantType) {
    text += `Jenis bencana yang paling sering terjadi adalah <strong>${disasterLabel(dominantType[0])}</strong> (${dominantType[1]} wilayah).`;
  }

  el.innerHTML = text;
}


/* ══════════════════════════════════════════
   11. UI UTILITIES
══════════════════════════════════════════ */

/** Sidebar toggle (mobile + desktop collapse) */
function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('menuToggle');

  btn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    // After animation, invalidate map size so tiles re-render
    setTimeout(() => STATE.map && STATE.map.invalidateSize(), 320);
  });
}

/** Close modal on overlay click or close button */
function initModal() {
  const overlay = document.getElementById('regionModalOverlay');
  const closeBtn = document.getElementById('modalClose');

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
  closeBtn.addEventListener('click', () => overlay.classList.remove('show'));
}

/** Live clock in topbar */
function initClock() {
  const el = document.getElementById('topbarTime');

  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) + ' WIB';
  }
  tick();
  setInterval(tick, 1000);
}


/* ══════════════════════════════════════════
   BOOT – Application Entry Point
══════════════════════════════════════════ */
(function boot() {
  initMap();           // 1. Create Leaflet map
  loadGeoJSON();       // 2. Fetch & render GeoJSON data
  initFilterButtons(); // 3. Wire filter buttons
  initSearch();        // 4. Wire search box
  initSidebarToggle(); // 5. Hamburger menu
  initModal();         // 6. Region detail modal
  initClock();         // 7. Live clock
})();
