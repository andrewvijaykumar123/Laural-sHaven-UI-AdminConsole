/* Laural's Haven shared map helper (OpenStreetMap tiles through self-hosted Leaflet). Identical in storefront and admin console. */
(() => {
  'use strict';
  const LH = window.LH;
  const VERSION = '1.9.4';
  let loading = null;

  const addCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
  // Leaflet is only fetched when a map is first needed, so the menu stays fast.
  function load() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      addCss(`vendor/leaflet/leaflet.css?v=${VERSION}`);
      addCss('map.css?v=20261029a');
      const s = document.createElement('script');
      s.src = `vendor/leaflet/leaflet.js?v=${VERSION}`;
      s.onload = () => (window.L && window.L.map ? resolve(window.L) : reject(new Error('Map library missing')));
      s.onerror = () => { loading = null; reject(new Error('Map library could not load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  const f5 = (n) => Number(n).toFixed(5);
  const osmUrl = (lat, lng) => `https://www.openstreetmap.org/?mlat=${f5(lat)}&mlon=${f5(lng)}#map=17/${f5(lat)}/${f5(lng)}`;
  const navUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${f5(lat)},${f5(lng)}`;

  const pin = (L, cls, glyph, size = 36) => L.divIcon({ className: `lh-pin ${cls}`, html: `<span>${glyph}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

  /*
   * create(el, { pick, onPick, pan }) resolves to a controller.
   *   pick: the customer can tap the map or drag the pin to choose a spot.
   *   pan:  allow one-finger panning (off by default inside scrolling sheets so the page can still scroll).
   */
  async function create(el, opts = {}) {
    const L = await load();
    const { SHOP, DELIVERY_KM, FREE_KM, MID_KM } = LH;
    const map = L.map(el, {
      zoomControl: true, scrollWheelZoom: false, attributionControl: true,
      dragging: opts.pan !== false || !L.Browser.mobile, touchZoom: opts.pan !== false || !L.Browser.mobile
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);

    const shopPt = L.latLng(SHOP.lat, SHOP.lng);
    const areaBounds = shopPt.toBounds(DELIVERY_KM * 2000); // bounds of the delivery circle; Circle#getBounds needs a ready map
    map.setView(shopPt, 12);
    [[DELIVERY_KM, 0.04, '#ff7a45'], [MID_KM, 0.05, '#ff7a45'], [FREE_KM, 0.09, '#34d399']].forEach(([km, fill, color]) => {
      L.circle(shopPt, { radius: km * 1000, color, weight: 2, dashArray: '6 6', fillColor: color, fillOpacity: fill, interactive: false }).addTo(map);
    });
    L.marker(shopPt, { icon: pin(L, 'shop', '🍃'), keyboard: false, title: "Laural's Haven" }).addTo(map);
    map.fitBounds(areaBounds, { padding: [6, 6] });

    let me = null, rider = null, line = null, dest = null;
    const ll = (lat, lng) => [lat, lng];

    function drawLine() {
      if (line) { line.remove(); line = null; }
      if (rider && dest) line = L.polyline([rider.getLatLng(), dest.getLatLng()], { color: '#8b5cf6', weight: 3, opacity: 0.8, dashArray: '2 8', interactive: false }).addTo(map);
    }

    const ctl = {
      map,
      // Customer pin: draggable when picking, fixed when only showing the delivery spot.
      setPin(lat, lng, o = {}) {
        if (!me) {
          me = L.marker(ll(lat, lng), { icon: pin(L, 'me', '📍'), draggable: !!opts.pick, autoPan: true, keyboard: !!opts.pick, title: 'Delivery location' }).addTo(map);
          if (opts.pick) me.on('dragend', () => { const p = me.getLatLng(); if (opts.onPick) opts.onPick(p.lat, p.lng); });
        } else me.setLatLng(ll(lat, lng));
        if (o.view) map.setView(ll(lat, lng), Math.max(map.getZoom(), 15));
      },
      clearPin() { if (me) { me.remove(); me = null; } },
      setDest(lat, lng) {
        if (!dest) dest = L.marker(ll(lat, lng), { icon: pin(L, 'home', '🏠'), keyboard: false, title: 'Delivery address' }).addTo(map);
        else dest.setLatLng(ll(lat, lng));
        drawLine();
      },
      setRider(lat, lng) {
        if (!rider) rider = L.marker(ll(lat, lng), { icon: pin(L, 'rider', '🛵', 40), zIndexOffset: 1000, keyboard: false, title: 'Delivery partner' }).addTo(map);
        else rider.setLatLng(ll(lat, lng));
        drawLine();
      },
      clearRider() { if (rider) { rider.remove(); rider = null; drawLine(); } },
      clearDest() { if (dest) { dest.remove(); dest = null; drawLine(); } },
      fit() {
        const pts = [ll(SHOP.lat, SHOP.lng)];
        [me, rider, dest].forEach((m) => { if (m) { const p = m.getLatLng(); pts.push([p.lat, p.lng]); } });
        if (pts.length === 1) map.fitBounds(areaBounds, { padding: [6, 6] });
        else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
      },
      invalidate() { map.invalidateSize(); },
      destroy() { if (ro) ro.disconnect(); map.remove(); }
    };
    if (opts.pick) {
      map.on('click', (e) => {
        ctl.setPin(e.latlng.lat, e.latlng.lng);
        if (opts.onPick) opts.onPick(e.latlng.lat, e.latlng.lng);
      });
    }
    // Drawers and sheets animate in; keep the tiles correct while the box changes size.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.invalidateSize()) : null;
    if (ro) ro.observe(el);
    setTimeout(() => map.invalidateSize(), 60);
    return ctl;
  }

  window.LHMap = { load, create, osmUrl, navUrl };
})();
