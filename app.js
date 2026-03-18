const DARK = '#222222';
const SELECTED = '#ff9800';
const STORAGE_KEY = 'electronic-chart-work-v4';

const map = L.map('map', {
  preferCanvas: true
}).setView([50.8, -1.4], 8);

const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

const seaMarkLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
  attribution: 'Map data: © OpenSeaMap contributors',
  maxZoom: 18,
  opacity: 0.9
}).addTo(map);

L.control.layers(
  { 'Base map': baseLayer },
  { 'OpenSeaMap seamarks': seaMarkLayer },
  { collapsed: true }
).addTo(map);

let currentTool = 'pan';
let objects = [];
let renderedEntries = [];
let selectedObjectId = null;

let draftStartPoint = null;
let holdDrawingActive = false;
let activePointerId = null;
let draftTempLatLng = null;
let tempLayers = [];
let suppressNextMapClick = false;

let freehandDrawingActive = false;
let freehandPoints = [];
let freehandTempLayer = null;

let fixPlacementActive = false;
let fixDragLatLng = null;

let actionMode = null;
let handleLayers = [];

const vectorLabel = document.getElementById('vectorLabel');
const statusBox = document.getElementById('status');
const actionBar = document.getElementById('actionBar');
const actionMoveBtn = document.getElementById('actionMoveBtn');
const actionEditBtn = document.getElementById('actionEditBtn');
const actionDeleteBtn = document.getElementById('actionDeleteBtn');
const actionDoneBtn = document.getElementById('actionDoneBtn');
const savePanel = document.getElementById('savePanel');
const loadPanel = document.getElementById('loadPanel');
const saveFilenameInput = document.getElementById('saveFilenameInput');
const savePanelCancelBtn = document.getElementById('savePanelCancelBtn');
const savePanelConfirmBtn = document.getElementById('savePanelConfirmBtn');
const loadPanelCancelBtn = document.getElementById('loadPanelCancelBtn');
const loadFileInput = document.getElementById('loadFileInput');
const mapEl = map.getContainer();

function generateId() {
  return 'obj_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
}

function setStatus(text) {
  statusBox.textContent = text + ' | Objects: ' + objects.length;
}

function defaultSaveFilename() {
  return 'chartwork-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function openSaveModal() {
  closeLoadModal();
  saveFilenameInput.value = defaultSaveFilename();
  savePanel.classList.remove('hidden');
  setTimeout(() => {
    saveFilenameInput.focus();
    saveFilenameInput.select();
  }, 0);
}

function closeSaveModal() {
  savePanel.classList.add('hidden');
}

function openLoadModal() {
  closeSaveModal();
  loadFileInput.value = '';
  loadPanel.classList.remove('hidden');
}

function closeLoadModal() {
  loadPanel.classList.add('hidden');
}

function getSelectedObject() {
  return objects.find(obj => obj.id === selectedObjectId) || null;
}

function clearHandleLayers() {
  for (const layer of handleLayers) {
    map.removeLayer(layer);
  }
  handleLayers = [];
}

function updateActionBar() {
  const show = currentTool === 'select' && !!selectedObjectId;
  actionBar.classList.toggle('hidden', !show);
  actionMoveBtn.classList.toggle('active', actionMode === 'move');
  actionEditBtn.classList.toggle('active', actionMode === 'edit');
}

function makeHandleIcon(kind = 'round') {
  return L.divIcon({
    className: '',
    html: `<div class="edit-handle ${kind === 'center' ? 'center' : ''} ${kind === 'square' ? 'square' : ''}"></div>`,
    iconSize: kind === 'center' ? [16, 16] : [14, 14],
    iconAnchor: kind === 'center' ? [8, 8] : [7, 7]
  });
}

function centroidForObject(obj) {
  if (obj.type === 'point') return L.latLng(obj.lat, obj.lng);
  if (obj.type === 'line') return L.latLng((obj.a.lat + obj.b.lat) / 2, (obj.a.lng + obj.b.lng) / 2);
  if (obj.type === 'freehand' && obj.points.length) {
    const sum = obj.points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
    return L.latLng(sum.lat / obj.points.length, sum.lng / obj.points.length);
  }
  return null;
}

function cloneObjectGeometry(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function applyMoveToObject(obj, originalObj, startLatLng, endLatLng) {
  const dLat = endLatLng.lat - startLatLng.lat;
  const dLng = endLatLng.lng - startLatLng.lng;

  if (obj.type === 'point') {
    obj.lat = originalObj.lat + dLat;
    obj.lng = originalObj.lng + dLng;
  } else if (obj.type === 'line') {
    obj.a.lat = originalObj.a.lat + dLat;
    obj.a.lng = originalObj.a.lng + dLng;
    obj.b.lat = originalObj.b.lat + dLat;
    obj.b.lng = originalObj.b.lng + dLng;
  } else if (obj.type === 'freehand') {
    obj.points = originalObj.points.map(p => ({ lat: p.lat + dLat, lng: p.lng + dLng }));
  }
}

function renderHandles() {
  clearHandleLayers();
  updateActionBar();

  const obj = getSelectedObject();
  if (currentTool !== 'select' || !obj || !actionMode) return;

  if (actionMode === 'move') {
    const center = centroidForObject(obj);
    if (!center) return;

    const handle = L.marker(center, {
      icon: makeHandleIcon('center'),
      draggable: true,
      keyboard: false
    }).addTo(map);

    const originalObj = cloneObjectGeometry(obj);
    const startCenter = centroidForObject(originalObj);

    handle.on('dragend', (e) => {
      const target = getSelectedObject();
      if (!target) return;
      applyMoveToObject(target, originalObj, startCenter, e.target.getLatLng());
      renderAllObjects();
      setStatus('Moved');
    });

    handleLayers.push(handle);
    return;
  }

  if (actionMode === 'edit') {
    if (obj.type === 'point') {
      const handle = L.marker(L.latLng(obj.lat, obj.lng), {
        icon: makeHandleIcon('square'),
        draggable: true,
        keyboard: false
      }).addTo(map);

      handle.on('dragend', (e) => {
        const target = getSelectedObject();
        if (!target) return;
        const ll = e.target.getLatLng();
        target.lat = ll.lat;
        target.lng = ll.lng;
        renderAllObjects();
        setStatus('Point edited');
      });

      handleLayers.push(handle);
      return;
    }

    if (obj.type === 'line') {
      const aHandle = L.marker(L.latLng(obj.a.lat, obj.a.lng), {
        icon: makeHandleIcon('round'),
        draggable: true,
        keyboard: false
      }).addTo(map);

      const bHandle = L.marker(L.latLng(obj.b.lat, obj.b.lng), {
        icon: makeHandleIcon('round'),
        draggable: true,
        keyboard: false
      }).addTo(map);

      aHandle.on('dragend', (e) => {
        const target = getSelectedObject();
        if (!target || target.type !== 'line') return;
        const ll = e.target.getLatLng();
        target.a = { lat: ll.lat, lng: ll.lng };
        renderAllObjects();
        setStatus('Line edited');
      });

      bHandle.on('dragend', (e) => {
        const target = getSelectedObject();
        if (!target || target.type !== 'line') return;
        const ll = e.target.getLatLng();
        target.b = { lat: ll.lat, lng: ll.lng };
        renderAllObjects();
        setStatus('Line edited');
      });

      handleLayers.push(aHandle, bHandle);
      return;
    }

    if (obj.type === 'freehand') {
      setStatus('Freehand: use Move');
    }
  }
}

function isLineTool(tool) {
  return [
    'line_steered',
    'line_madegood',
    'line_set',
    'line_posn'
  ].includes(tool);
}

function degToRad(d) {
  return d * Math.PI / 180;
}

function radToDeg(r) {
  return r * 180 / Math.PI;
}

function latLngToPlain(ll) {
  return { lat: ll.lat, lng: ll.lng };
}

function clientToLatLng(clientX, clientY) {
  const rect = mapEl.getBoundingClientRect();
  const containerPoint = L.point(clientX - rect.left, clientY - rect.top);
  return map.containerPointToLatLng(containerPoint);
}

function formatLatLonDM(latlng) {
  return formatLatitudeDM(latlng.lat) + '<br>' + formatLongitudeDM(latlng.lng);
}

function formatLatitudeDM(lat) {
  const hemi = lat >= 0 ? 'N' : 'S';
  const abs = Math.abs(lat);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(2, '0')}°${min.toFixed(1)}'${hemi}`;
}

function formatLongitudeDM(lng) {
  const hemi = lng >= 0 ? 'E' : 'W';
  const abs = Math.abs(lng);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${String(deg).padStart(3, '0')}°${min.toFixed(1)}'${hemi}`;
}


function buildSavePayload() {
  return {
    app: 'electronic-chart-work',
    version: 2,
    savedAt: new Date().toISOString(),
    objects
  };
}

function sanitizeFilenamePart(name) {
  return (name || 'artefacts')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'artefacts';
}

function downloadTextFile(filename, content, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadObjectsFromParsedFile(data) {
  if (!data || !Array.isArray(data.objects)) {
    throw new Error('Invalid save file');
  }

  objects = data.objects;
  selectedObjectId = null;
  actionMode = null;
  clearHandleLayers();
  cancelLineDraft();
  cancelFreehandDraft();
  cancelFixDraft();
  renderAllObjects();
  setStatus('Loaded file');
}

function showCoordinateLabel(latlng, clientX, clientY) {
  vectorLabel.innerHTML = formatLatLonDM(latlng);
  vectorLabel.style.left = (clientX + 12) + 'px';
  vectorLabel.style.top = (clientY - 44) + 'px';
  vectorLabel.style.display = 'block';
}

function nauticalMilesBetween(a, b) {
  const Rnm = 3440.065;
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const dLat = degToRad(b.lat - a.lat);
  const dLon = degToRad(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Rnm * c;
}

function bearingDegrees(a, b) {
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const dLon = degToRad(b.lng - a.lng);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (radToDeg(Math.atan2(y, x)) + 360) % 360;
}

function samePoint(a, b) {
  return a && b && a.lat === b.lat && a.lng === b.lng;
}

function shouldKeepFreehandPoint(candidate) {
  if (freehandPoints.length === 0) return true;
  const last = freehandPoints[freehandPoints.length - 1];
  const distPx = map.latLngToContainerPoint(candidate).distanceTo(map.latLngToContainerPoint(last));
  return distPx >= 2;
}

function activateTool(tool, statusText) {
  currentTool = tool;

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  cancelLineDraft();
  cancelFreehandDraft();
  cancelFixDraft();

  if (tool !== 'select') {
    selectedObjectId = null;
    actionMode = null;
    clearHandleLayers();
  }

  if (tool === 'pan') {
    enableMapPan();
    setStatus(statusText || 'Pan mode');
  } else if (tool === 'gps') {
    disableMapPan();
    setStatus(statusText || 'Fix: press, drag, release');
  } else if (tool === 'wpt') {
    disableMapPan();
    setStatus(statusText || 'Waypoint');
  } else if (tool === 'select') {
    disableMapPan();
    setStatus(statusText || 'Select object');
  } else if (tool === 'freehand') {
    disableMapPan();
    setStatus(statusText || 'Freehand: press, scribble, lift');
  } else if (isLineTool(tool)) {
    disableMapPan();
    setStatus(statusText || 'Line: press, drag, release');
  }

  updateActionBar();
  renderHandles();
}

function returnToPan(statusText) {
  activateTool('pan', statusText || 'Pan mode');
}


function objectAnchorLatLng(obj, clickLatLng) {
  if (obj.type === 'point') return L.latLng(obj.lat, obj.lng);
  if (clickLatLng) return clickLatLng;
  if (obj.type === 'line') return L.latLng(obj.a.lat, obj.a.lng);
  if (obj.type === 'freehand' && obj.points && obj.points.length > 0) {
    return L.latLng(obj.points[0].lat, obj.points[0].lng);
  }
  return null;
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    activateTool(btn.dataset.tool);
  });
});

map.on('click', function(e) {
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }

  if (currentTool === 'gps') {
    return;
  }

  if (currentTool === 'wpt') {
    return;
  }

  if (currentTool === 'freehand') {
    return;
  }

  if (currentTool === 'select') {
    if (selectedObjectId) {
      selectedObjectId = null;
      actionMode = null;
      renderAllObjects();
      setStatus('Deselected');
    }
    return;
  }

  if (isLineTool(currentTool)) {
    return;
  }
});

mapEl.addEventListener('pointerdown', (evt) => {
  if (currentTool === 'gps' || currentTool === 'wpt') {
    activePointerId = evt.pointerId;
    fixPlacementActive = true;
    fixDragLatLng = clientToLatLng(evt.clientX, evt.clientY);
    showCoordinateLabel(fixDragLatLng, evt.clientX, evt.clientY);
    suppressNextMapClick = true;
    evt.preventDefault();
    return;
  }

  if (currentTool === 'freehand') {
    activePointerId = evt.pointerId;
    freehandDrawingActive = true;
    freehandPoints = [];

    const ll = clientToLatLng(evt.clientX, evt.clientY);
    freehandPoints.push(ll);
    drawTemporaryFreehand();

    suppressNextMapClick = true;
    evt.preventDefault();
    return;
  }

  if (!isLineTool(currentTool)) return;

  activePointerId = evt.pointerId;
  holdDrawingActive = true;

  const ll = clientToLatLng(evt.clientX, evt.clientY);
  draftStartPoint = ll;
  draftTempLatLng = ll;
  drawTemporaryLine(draftStartPoint, draftTempLatLng, currentTool);
  updateVectorLabel(draftStartPoint, draftTempLatLng, evt.clientX, evt.clientY);

  suppressNextMapClick = true;
  evt.preventDefault();
});

mapEl.addEventListener('pointermove', (evt) => {
  if ((currentTool === 'gps' || currentTool === 'wpt') && fixPlacementActive) {
    if (evt.pointerId !== activePointerId) return;
    fixDragLatLng = clientToLatLng(evt.clientX, evt.clientY);
    showCoordinateLabel(fixDragLatLng, evt.clientX, evt.clientY);
    return;
  }

  if (currentTool === 'freehand' && freehandDrawingActive) {
    if (evt.pointerId !== activePointerId) return;
    const ll = clientToLatLng(evt.clientX, evt.clientY);
    if (shouldKeepFreehandPoint(ll)) {
      freehandPoints.push(ll);
      drawTemporaryFreehand();
    }
    return;
  }

  if (!holdDrawingActive) return;
  if (evt.pointerId !== activePointerId) return;
  if (!draftStartPoint) return;
  if (!isLineTool(currentTool)) return;

  const ll = clientToLatLng(evt.clientX, evt.clientY);
  draftTempLatLng = ll;
  drawTemporaryLine(draftStartPoint, draftTempLatLng, currentTool);
  updateVectorLabel(draftStartPoint, draftTempLatLng, evt.clientX, evt.clientY);
}, { passive: true });

mapEl.addEventListener('pointerup', (evt) => {
  if ((currentTool === 'gps' || currentTool === 'wpt') && fixPlacementActive) {
    if (evt.pointerId !== activePointerId) return;

    const ll = clientToLatLng(evt.clientX, evt.clientY);
    const subtype = currentTool === 'wpt' ? 'wpt' : 'gps';
    createPointObject(ll, subtype);
    hideVectorLabel();
    cancelFixDraft();
    suppressNextMapClick = true;
    returnToPan(subtype === 'wpt' ? 'WPT added' : 'Fix added');
    return;
  }

  if (currentTool === 'freehand' && freehandDrawingActive) {
    if (evt.pointerId !== activePointerId) return;

    const ll = clientToLatLng(evt.clientX, evt.clientY);
    if (shouldKeepFreehandPoint(ll)) {
      freehandPoints.push(ll);
    }

    if (freehandPoints.length >= 2) {
      createFreehandObject(freehandPoints);
      setStatus('Freehand added');
    } else {
      setStatus('Freehand cancelled');
    }

    cancelFreehandDraft();
    suppressNextMapClick = true;
    return;
  }

  if (!holdDrawingActive) return;
  if (evt.pointerId !== activePointerId) return;
  if (!draftStartPoint) return;
  if (!isLineTool(currentTool)) return;

  const ll = clientToLatLng(evt.clientX, evt.clientY);

  if (!samePoint(draftStartPoint, ll)) {
    createLineObject(draftStartPoint, ll, currentTool);
    returnToPan('Line added');
  } else {
    setStatus('Line cancelled');
  }

  draftStartPoint = null;
  holdDrawingActive = false;
  activePointerId = null;
  draftTempLatLng = null;

  clearTemporaryLine();
  hideVectorLabel();

  suppressNextMapClick = true;
});

mapEl.addEventListener('pointercancel', () => {
  if (fixPlacementActive) {
    cancelFixDraft();
    hideVectorLabel();
  }
  if (freehandDrawingActive) {
    cancelFreehandDraft();
  }
  holdDrawingActive = false;
  activePointerId = null;
  draftTempLatLng = null;
  clearTemporaryLine();
  hideVectorLabel();
});

function createPointObject(latlng, subtype) {
  objects.push({
    id: generateId(),
    type: 'point',
    subtype,
    lat: latlng.lat,
    lng: latlng.lng
  });
  renderAllObjects();
}

function createLineObject(a, b, subtype) {
  objects.push({
    id: generateId(),
    type: 'line',
    subtype,
    a: latLngToPlain(a),
    b: latLngToPlain(b)
  });
  renderAllObjects();
}

function createFreehandObject(points) {
  objects.push({
    id: generateId(),
    type: 'freehand',
    points: points.map(latLngToPlain)
  });
  renderAllObjects();
}

function renderAllObjects() {
  clearRendered();
  for (const obj of objects) {
    const entry = renderObject(obj);
    renderedEntries.push(entry);
  }
  updateActionBar();
  renderHandles();
}

function clearRendered() {
  for (const entry of renderedEntries) {
    for (const layer of entry.layers) {
      map.removeLayer(layer);
    }
  }
  renderedEntries = [];
}

function renderObject(obj) {
  let layers = [];

  if (obj.type === 'point') {
    layers = renderPoint(obj);
  } else if (obj.type === 'line') {
    layers = renderLine(obj, false);
  } else if (obj.type === 'freehand') {
    layers = renderFreehand(obj, false);
  }

  for (const layer of layers) {
    layer.on('click', (e) => {
      if (currentTool === 'select') {
        const wasSelected = selectedObjectId === obj.id;
        selectedObjectId = wasSelected ? null : obj.id;
        actionMode = null;
        suppressNextMapClick = true;
        renderAllObjects();
        setStatus(selectedObjectId ? 'Selected' : 'Deselected');
        if (e.originalEvent) {
          e.originalEvent.stopPropagation();
          e.originalEvent.preventDefault();
        }
        return;
      }

    });
  }

  return { id: obj.id, layers };
}

function renderPoint(obj) {
  const selected = obj.id === selectedObjectId;
  const className = selected ? 'selected' : 'normal';

  const latlng = L.latLng(obj.lat, obj.lng);
  let html = '';

  if (obj.subtype === 'gps') {
    html = `
      <div class="point-symbol gps ${className}">
        <div class="circle-ring"></div>
        <div class="core-dot"></div>
      </div>
    `;
  }

  if (obj.subtype === 'wpt') {
    html = `
      <div class="point-symbol wpt ${className}">
        <div class="hline"></div>
        <div class="vline"></div>
        <div class="square-ring"></div>
        <div class="core-dot"></div>
      </div>
    `;
  }

  const icon = L.divIcon({
    className: '',
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  const marker = L.marker(latlng, { icon }).addTo(map);
  return [marker];
}

function renderLine(obj, dashedPreview) {
  const a = L.latLng(obj.a.lat, obj.a.lng);
  const b = L.latLng(obj.b.lat, obj.b.lng);
  const selected = obj.id === selectedObjectId;
  const color = selected ? SELECTED : DARK;
  const weight = selected ? 4.5 : 3;

  const layers = [];

  if (!dashedPreview) {
    const hitLine = L.polyline([a, b], {
      color: '#000000',
      weight: 18,
      opacity: 0.001,
      lineCap: 'round'
    }).addTo(map);
    layers.push(hitLine);
  }

  const baseLine = L.polyline([a, b], {
    color,
    weight,
    dashArray: dashedPreview ? '7,7' : null,
    lineCap: 'butt'
  }).addTo(map);
  layers.push(baseLine);

  const decoPolylines = buildChevronPolylines(a, b, obj.subtype, color, weight, dashedPreview);
  for (const pl of decoPolylines) {
    pl.addTo(map);
    layers.push(pl);
  }

  if (!dashedPreview) {
    const labelLayers = buildLineLabelLayers(a, b, color);
    for (const layer of labelLayers) {
      layer.addTo(map);
      layers.push(layer);
    }
  }

  return layers;
}

function renderFreehand(obj, dashedPreview) {
  const selected = obj.id === selectedObjectId;
  const color = selected ? SELECTED : DARK;
  const weight = selected ? 4.5 : 3;
  const latlngs = obj.points.map(p => L.latLng(p.lat, p.lng));

  const line = L.polyline(latlngs, {
    color,
    weight,
    dashArray: dashedPreview ? '7,7' : null,
    lineCap: 'round',
    lineJoin: 'round',
    smoothFactor: 0
  }).addTo(map);

  return [line];
}

function buildChevronPolylines(a, b, subtype, color, weight, dashedPreview) {
  const chevronSets = [];
  const chevLen = 9;
  const chevSpread = 9;

  if (subtype === 'line_steered') {
    chevronSets.push(makeChevronAtFraction(a, b, 0.72, chevLen, chevSpread));
  } else if (subtype === 'line_madegood') {
    chevronSets.push(makeChevronAtFraction(a, b, 0.66, chevLen, chevSpread));
    chevronSets.push(makeChevronAtFraction(a, b, 0.76, chevLen, chevSpread));
  } else if (subtype === 'line_set') {
    chevronSets.push(makeChevronAtFraction(a, b, 0.60, chevLen, chevSpread));
    chevronSets.push(makeChevronAtFraction(a, b, 0.70, chevLen, chevSpread));
    chevronSets.push(makeChevronAtFraction(a, b, 0.80, chevLen, chevSpread));
  } else if (subtype === 'line_posn') {
    chevronSets.push(makeChevronAtStart(a, b, chevLen, chevSpread));
  }

  const lines = [];
  for (const set of chevronSets) {
    lines.push(
      L.polyline(set.leftArm, {
        color,
        weight,
        dashArray: dashedPreview ? '7,7' : null,
        lineCap: 'butt'
      }),
      L.polyline(set.rightArm, {
        color,
        weight,
        dashArray: dashedPreview ? '7,7' : null,
        lineCap: 'butt'
      })
    );
  }

  return lines;
}

function makeChevronAtFraction(a, b, t, lengthPx, spreadPx) {
  const pa = map.latLngToContainerPoint(a);
  const pb = map.latLngToContainerPoint(b);

  const vx = pb.x - pa.x;
  const vy = pb.y - pa.y;
  const mag = Math.sqrt(vx * vx + vy * vy) || 1;

  const ux = vx / mag;
  const uy = vy / mag;
  const px = -uy;
  const py = ux;

  const tipX = pa.x + vx * t;
  const tipY = pa.y + vy * t;

  const baseX = tipX - ux * lengthPx;
  const baseY = tipY - uy * lengthPx;

  const leftX = baseX + px * spreadPx;
  const leftY = baseY + py * spreadPx;

  const rightX = baseX - px * spreadPx;
  const rightY = baseY - py * spreadPx;

  const tip = map.containerPointToLatLng(L.point(tipX, tipY));
  const left = map.containerPointToLatLng(L.point(leftX, leftY));
  const right = map.containerPointToLatLng(L.point(rightX, rightY));

  return {
    leftArm: [left, tip],
    rightArm: [right, tip]
  };
}

function makeChevronAtStart(a, b, lengthPx, spreadPx) {
  const pa = map.latLngToContainerPoint(a);
  const pb = map.latLngToContainerPoint(b);

  const vx = pb.x - pa.x;
  const vy = pb.y - pa.y;
  const mag = Math.sqrt(vx * vx + vy * vy) || 1;

  const ux = vx / mag;
  const uy = vy / mag;
  const px = -uy;
  const py = ux;

  const tipX = pa.x;
  const tipY = pa.y;

  const baseX = tipX + ux * lengthPx;
  const baseY = tipY + uy * lengthPx;

  const leftX = baseX + px * spreadPx;
  const leftY = baseY + py * spreadPx;

  const rightX = baseX - px * spreadPx;
  const rightY = baseY - py * spreadPx;

  const tip = map.containerPointToLatLng(L.point(tipX, tipY));
  const left = map.containerPointToLatLng(L.point(leftX, leftY));
  const right = map.containerPointToLatLng(L.point(rightX, rightY));

  return {
    leftArm: [left, tip],
    rightArm: [right, tip]
  };
}

function buildLineLabelLayers(a, b, color) {
  const pa = map.latLngToContainerPoint(a);
  const pb = map.latLngToContainerPoint(b);
  const vx = pb.x - pa.x;
  const vy = pb.y - pa.y;
  const mag = Math.sqrt(vx * vx + vy * vy) || 1;

  const ux = vx / mag;
  const uy = vy / mag;
  const px = -uy;
  const py = ux;

  let angle = Math.atan2(vy, vx) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;

  const midX = (pa.x + pb.x) / 2;
  const midY = (pa.y + pb.y) / 2;
  const offsetPx = 14;

  const sideA = { x: midX - px * offsetPx, y: midY - py * offsetPx };
  const sideB = { x: midX + px * offsetPx, y: midY + py * offsetPx };

  const topSide = sideA.y <= sideB.y ? sideA : sideB;
  const bottomSide = sideA.y <= sideB.y ? sideB : sideA;

  const directionPoint = map.containerPointToLatLng(L.point(topSide.x, topSide.y));
  const distancePoint = map.containerPointToLatLng(L.point(bottomSide.x, bottomSide.y));

  const directionText = `(${String(Math.round(bearingDegrees(a, b))).padStart(3, '0')})T`;
  const distanceText = `${nauticalMilesBetween(a, b).toFixed(1)}nm`;

  return [
    buildTextMarker(directionPoint, directionText, angle, color),
    buildTextMarker(distancePoint, distanceText, angle, color)
  ];
}

function buildTextMarker(latlng, text, angleDeg, color) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="color:${color}; font: 600 12px Arial, sans-serif; white-space:nowrap; text-shadow: -1px -1px 0 rgba(255,255,255,0.95), 1px -1px 0 rgba(255,255,255,0.95), -1px 1px 0 rgba(255,255,255,0.95), 1px 1px 0 rgba(255,255,255,0.95); transform: rotate(${angleDeg}deg); transform-origin:center center; pointer-events:none;">${text}</div>`,
    iconSize: [80, 18],
    iconAnchor: [40, 9]
  });

  return L.marker(latlng, { icon, interactive: false, keyboard: false });
}

function drawTemporaryLine(a, b, subtype) {
  clearTemporaryLine();

  const previewObj = {
    id: 'temp',
    type: 'line',
    subtype,
    a: latLngToPlain(a),
    b: latLngToPlain(b)
  };

  tempLayers = renderLine(previewObj, true);
}

function clearTemporaryLine() {
  for (const layer of tempLayers) {
    map.removeLayer(layer);
  }
  tempLayers = [];
}

function drawTemporaryFreehand() {
  if (freehandTempLayer) {
    map.removeLayer(freehandTempLayer);
    freehandTempLayer = null;
  }

  if (freehandPoints.length < 2) return;

  freehandTempLayer = L.polyline(freehandPoints, {
    color: DARK,
    weight: 3,
    lineCap: 'round',
    lineJoin: 'round',
    smoothFactor: 0
  }).addTo(map);
}

function cancelLineDraft() {
  draftStartPoint = null;
  draftTempLatLng = null;
  holdDrawingActive = false;
  activePointerId = null;
  clearTemporaryLine();
  hideVectorLabel();
}

function cancelFreehandDraft() {
  freehandDrawingActive = false;
  activePointerId = null;
  freehandPoints = [];
  if (freehandTempLayer) {
    map.removeLayer(freehandTempLayer);
    freehandTempLayer = null;
  }
}

function cancelFixDraft() {
  fixPlacementActive = false;
  fixDragLatLng = null;
  activePointerId = null;
}

function updateVectorLabel(a, b, clientX, clientY) {
  const nm = nauticalMilesBetween(a, b);
  const brg = bearingDegrees(a, b);

  vectorLabel.innerHTML =
    nm.toFixed(2) + ' nm<br>' +
    brg.toFixed(0) + '°T';

  vectorLabel.style.left = (clientX + 12) + 'px';
  vectorLabel.style.top = (clientY + 12) + 'px';
  vectorLabel.style.display = 'block';
}

function hideVectorLabel() {
  vectorLabel.style.display = 'none';
}


actionMoveBtn.addEventListener('click', () => {
  if (!selectedObjectId) {
    setStatus('No object selected');
    return;
  }
  actionMode = actionMode === 'move' ? null : 'move';
  renderHandles();
  setStatus(actionMode === 'move' ? 'Move selected object' : 'Selected');
});

actionEditBtn.addEventListener('click', () => {
  const obj = getSelectedObject();
  if (!obj) {
    setStatus('No object selected');
    return;
  }
  if (obj.type === 'freehand') {
    actionMode = null;
    renderHandles();
    setStatus('Freehand: use Move');
    return;
  }
  actionMode = actionMode === 'edit' ? null : 'edit';
  renderHandles();
  setStatus(actionMode === 'edit' ? 'Edit selected object' : 'Selected');
});

actionDeleteBtn.addEventListener('click', () => {
  if (!selectedObjectId) {
    setStatus('No object selected');
    return;
  }
  objects = objects.filter(obj => obj.id !== selectedObjectId);
  selectedObjectId = null;
  actionMode = null;
  renderAllObjects();
  setStatus('Deleted');
});

actionDoneBtn.addEventListener('click', () => {
  selectedObjectId = null;
  actionMode = null;
  renderAllObjects();
  setStatus('Done');
});

document.getElementById('saveBtn').addEventListener('click', () => {
  openSaveModal();
  setStatus('Save panel opened');
});

document.getElementById('loadBtn').addEventListener('click', () => {
  openLoadModal();
  setStatus('Load panel opened');
});

savePanelCancelBtn.addEventListener('click', () => {
  closeSaveModal();
  setStatus('Save cancelled');
});

savePanelConfirmBtn.addEventListener('click', () => {
  try {
    const payload = buildSavePayload();
    const filename = sanitizeFilenamePart(saveFilenameInput.value) + '.json';
    downloadTextFile(filename, JSON.stringify(payload, null, 2));
    closeSaveModal();
    setStatus('Saved file');
  } catch (err) {
    console.error(err);
    setStatus('Save failed');
  }
});

loadPanelCancelBtn.addEventListener('click', () => {
  closeLoadModal();
  setStatus('Load cancelled');
});

loadFileInput.addEventListener('change', async (event) => {
  try {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      setStatus('Load cancelled');
      return;
    }

    const text = await file.text();
    const parsed = JSON.parse(text);
    loadObjectsFromParsedFile(parsed);
    closeLoadModal();
  } catch (err) {
    console.error(err);
    setStatus('Invalid load file');
  }
});


saveFilenameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    savePanelConfirmBtn.click();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    savePanelCancelBtn.click();
  }
});

document.getElementById('clearBtn').addEventListener('click', () => {
  objects = [];
  selectedObjectId = null;
  actionMode = null;
  clearHandleLayers();
  cancelLineDraft();
  cancelFreehandDraft();
  cancelFixDraft();
  clearRendered();
  setStatus('Cleared');
  updateActionBar();
});

function enableMapPan() {
  map.dragging.enable();
  map.touchZoom.enable();
  map.doubleClickZoom.enable();
  map.scrollWheelZoom.enable();
  map.boxZoom.enable();
  map.keyboard.enable();
}

function disableMapPan() {
  map.dragging.disable();
  map.touchZoom.disable();
  map.doubleClickZoom.disable();
  map.scrollWheelZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();
}

activateTool('pan', 'Ready');
