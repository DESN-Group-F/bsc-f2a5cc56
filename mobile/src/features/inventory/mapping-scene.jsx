import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, MapPin, List, SlidersHorizontal, X } from 'lucide-react';
import { formatTime } from '../../shared/lib/client-utils.js';
import { mappingUnknownReason, UNKNOWN_MAPPING_ROOM } from '../../shared/lib/inventory-mapping.js';
import { mappingSummaries } from './inventory-model.mjs';
import { defaultMappingCamera, schematicRoomModules } from './mapping-geometry.mjs';
import { createMappingRenderer } from './mapping-renderer.mjs';
import { iosPresentation } from '../../app/ios-runtime-presentation.mjs';
import { REFERENCE_BUILDINGS, SUPPORTED_BUILDING_ID } from '../../shared/lib/location-catalog.js';
import { usePhoneBack, usePhoneReducedMotion } from '../../app/phone-ui.jsx';
import { PhoneTaskDialog } from '../workspace/phone-task-dialog.jsx';

const sceneMemory = new Map();
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
function useReducedMotion() {
  const appReduced = usePhoneReducedMotion();
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const query = window.matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  return reduced || appReduced;
}
function useWideMapping() {
  const media = '(min-width:620px) and (max-height:550px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(media).matches);
  useEffect(() => { const query = window.matchMedia(media); const change = () => setWide(query.matches); change(); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  return wide;
}

export function MappingScene({ data, memoryKey, active = true, onRoom }) {
  const saved = sceneMemory.get(memoryKey);
  const [selectedId, setSelectedId] = useState(saved?.selectedId ?? null), [labels, setLabels] = useState([]), [failure, setFailure] = useState('');
  const [simpleEffects, setSimpleEffects] = useState(saved?.simpleEffects ?? false), [roomSearch, setRoomSearch] = useState(saved?.roomSearch ?? ''), [interacting, setInteracting] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false), [mapView, setMapView] = useState('scene');
  const [filterOpen, setFilterOpen] = useState(false), filterButton = useRef(null), filterId = React.useId();
  const reduced = useReducedMotion(), wide = useWideMapping(), canvas = useRef(null), renderer = useRef(null), camera = useRef(saved?.camera ?? defaultMappingCamera());
  const frame = useRef(0), transitionFrame = useRef(0), visible = useRef(active), points = useRef(new Map()), gesture = useRef(null), selected = useRef(selectedId), lastFocused = useRef(selectedId), effects = useRef(simpleEffects || reduced), simpleSetting = useRef(simpleEffects);
  const savedSearch = useRef(roomSearch); savedSearch.current = roomSearch;
  const summaries = useMemo(() => mappingSummaries(data), [data]);
  const roomSignature = summaries.filter(item => item.id !== UNKNOWN_MAPPING_ROOM).map(item => item.id).join('|');
  const modules = useMemo(() => schematicRoomModules(summaries.filter(item => item.id !== UNKNOWN_MAPPING_ROOM)), [roomSignature]);
  const summary = summaries.find(item => item.id === selectedId);
  selected.current = selectedId; effects.current = simpleEffects || reduced; simpleSetting.current = simpleEffects;
  function remember() { sceneMemory.set(memoryKey, { camera: { ...camera.current, target: [...camera.current.target] }, selectedId: selected.current, simpleEffects: simpleSetting.current, roomSearch: savedSearch.current }); }
  function endInteraction(persist = true) {
    const element = canvas.current;
    for (const id of points.current.keys()) if (element?.hasPointerCapture?.(id)) element.releasePointerCapture(id);
    points.current.clear(); gesture.current = null; setInteracting(false); if (persist) remember();
  }
  usePhoneBack(() => { endInteraction(); return true; }, { enabled: active && interacting, priority: 35 });
  function renderSoon() {
    if (!visible.current || frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; if (visible.current) renderer.current?.draw(camera.current, selected.current, effects.current); });
  }
  function stopTransition() { cancelAnimationFrame(transitionFrame.current); transitionFrame.current = 0; }
  function moveCamera(patch) { stopTransition(); camera.current = { ...camera.current, ...patch }; remember(); renderSoon(); }
  useEffect(() => {
    camera.current = sceneMemory.get(memoryKey)?.camera ?? defaultMappingCamera();
    lastFocused.current = sceneMemory.get(memoryKey)?.selectedId ?? null;
    setSelectedId(sceneMemory.get(memoryKey)?.selectedId ?? null);
    setRoomSearch(sceneMemory.get(memoryKey)?.roomSearch ?? '');
    endInteraction(false);
  }, [memoryKey]);
  useEffect(() => {
    setFailure(''); let engine;
    try { engine = createMappingRenderer(canvas.current, modules, setLabels, { appearance:iosPresentation?'ios':'light' }); renderer.current = engine; renderSoon(); }
    catch (error) { setFailure(error.message); }
    const resize = new ResizeObserver(renderSoon); resize.observe(canvas.current);
    const lost = event => { event.preventDefault(); endInteraction(); setFailure('The 3D scene was interrupted. Use the room list, or return to Mapping to retry.'); cancelAnimationFrame(frame.current); frame.current = 0; };
    canvas.current.addEventListener('webglcontextlost', lost);
    const element = canvas.current;
    return () => { remember(); resize.disconnect(); element.removeEventListener('webglcontextlost', lost); cancelAnimationFrame(frame.current); frame.current = 0; stopTransition(); engine?.dispose(); renderer.current = null; };
  }, [modules]);
  useEffect(() => {
    function update() {
      visible.current = active && document.visibilityState === 'visible';
      if (visible.current) renderSoon(); else { endInteraction(); cancelAnimationFrame(frame.current); frame.current = 0; stopTransition(); }
    }
    update(); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update);
  }, [active]);
  useEffect(() => { renderSoon(); }, [simpleEffects, reduced]);
  useEffect(() => { remember(); }, [roomSearch]);
  useEffect(() => {
    remember(); const shouldFocus = selectedId !== lastFocused.current;
    lastFocused.current = selectedId;
    const module = modules.find(item => item.id === selectedId);
    stopTransition();
    if (!module || !visible.current || !shouldFocus) { renderSoon(); return; }
    const from = camera.current, target = [module.center[0], 0, module.center[2]], zoom = Math.min(1.7, Math.max(from.zoom, 1.25));
    if (reduced) { camera.current = { ...from, target, zoom }; remember(); renderSoon(); return; }
    const began = performance.now();
    function animate(now) {
      if (!visible.current) return;
      const progress = Math.min(1, (now - began) / 200), eased = 1 - (1 - progress) ** 3;
      camera.current = { ...from, target: from.target.map((value, index) => value + (target[index] - value) * eased), zoom: from.zoom + (zoom - from.zoom) * eased };
      renderSoon();
      if (progress < 1) transitionFrame.current = requestAnimationFrame(animate); else { transitionFrame.current = 0; remember(); }
    }
    transitionFrame.current = requestAnimationFrame(animate);
    return stopTransition;
  }, [selectedId, modules, reduced]);
  function pointerDown(event) {
    if (!visible.current || failure) return;
    if (interacting) { stopTransition(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 1) {
      const scrollAt = Number(event.currentTarget.closest?.('[data-phone-scroll]')?.dataset.phoneScrollAt || 0);
      gesture.current = { x: event.clientX, y: event.clientY, moved: !interacting && scrollAt > 0 && performance.now() - scrollAt < 120, multiple: false };
    }
    else if (gesture.current) gesture.current.multiple = true;
  }
  function pointerMove(event) {
    if (!points.current.has(event.pointerId) || !visible.current) return;
    const before = [...points.current.values()], previous = points.current.get(event.pointerId);
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...points.current.values()];
    if (gesture.current && Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 8) gesture.current.moved = true;
    if (!interacting) return;
    event.stopPropagation();
    if (!gesture.current?.moved && after.length === 1) return;
    if (after.length === 1) moveCamera({ yaw: camera.current.yaw + (event.clientX - previous.x) * .008, pitch: clamp(camera.current.pitch + (event.clientY - previous.y) * .006, .24, 1.25) });
    else {
      const distance = values => Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      const middle = values => ({ x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 });
      const a = middle(before), b = middle(after), scale = .02 / camera.current.zoom, yaw = camera.current.yaw;
      const dx = (b.x - a.x) * scale, dy = (b.y - a.y) * scale;
      moveCamera({ zoom: clamp(camera.current.zoom * distance(after) / Math.max(1, distance(before)), .55, 2.8), target: [camera.current.target[0] - dx * Math.cos(yaw) - dy * Math.sin(yaw), 0, camera.current.target[2] + dx * Math.sin(yaw) - dy * Math.cos(yaw)] });
    }
  }
  function pointerUp(event) {
    if (!points.current.has(event.pointerId)) return;
    if (event.type === 'pointerup' && points.current.size === 1 && gesture.current && !gesture.current.moved && !gesture.current.multiple) {
      const id = renderer.current?.pick(event.clientX, event.clientY); if (id) { setSelectedId(id); setSummaryOpen(true); }
    }
    points.current.delete(event.pointerId); if (!points.current.size) gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const filteredRooms = summaries.filter(item => `${item.label} ${item.number}`.toLowerCase().includes(roomSearch.trim().toLowerCase()));
  function chooseRoom(id) { endInteraction(); setSelectedId(id); setSummaryOpen(true); }
  function openRecords() { if (summary) { setSummaryOpen(false); onRoom({ kind: 'room', id: summary.id, label: summary.label }); } }
  function summaryContent() {
    return <><p className="mi-eyebrow">{summary.id === UNKNOWN_MAPPING_ROOM ? 'Evidence not mapped' : summary.placeholder ? 'Placeholder room' : 'Selected room'}</p><h3>{summary.label}</h3><p className="mi-room-counts"><strong>{summary.total}</strong> recorded · {summary.inStore} in store · {summary.inUse} in use</p><p className="mi-help">Latest dated observations; present location is not confirmed.</p>{summary.batteries.length ? <ul className="mi-evidence-preview">{[...summary.batteries].sort((a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0)).slice(0, 2).map(battery => <li key={battery.id}><strong>{battery.id}</strong>{!battery.observedAt ? <span>No observation recorded</span> : <><span>{summary.id === UNKNOWN_MAPPING_ROOM ? mappingUnknownReason(battery) : battery.observationRoomSnapshot === 'recorded' ? [battery.observedBuilding, battery.observedRoom].filter(Boolean).join(' · ') : 'Recorded address unavailable'}</span><small>{Number.isFinite(Date.parse(battery.observedAt)) ? formatTime(battery.observedAt) : 'Observation time unavailable'} · {battery.observationSource ?? 'Source unavailable'}</small></>}</li>)}</ul> : <p className="mi-help">No active batteries mapped to this room.</p>}</>;
  }
  return <section className="mi-mapping" aria-label="Mapping">
    <div className="mi-map-heading"><div><h2>Last recorded room evidence</h2><p>J18 · Willis Annexe · dated observations</p></div><button ref={filterButton} type="button" aria-expanded={filterOpen} aria-controls={filterId} onClick={() => setFilterOpen(value => !value)}><SlidersHorizontal size={18} aria-hidden="true" />Building<ChevronDown size={16} aria-hidden="true" /></button></div>
    <section className="mi-building-filter" id={filterId} aria-label="Mapping building filter" hidden={!filterOpen}><h3>Building</h3><div>{REFERENCE_BUILDINGS.map(building => <button key={building.id} type="button" aria-pressed={building.id === SUPPORTED_BUILDING_ID} disabled={building.id !== SUPPORTED_BUILDING_ID} onClick={() => filterButton.current?.focus({ preventScroll: true })}><Building2 size={20} aria-hidden="true" /><span><strong>{building.id}</strong><small>{building.name}{building.id !== SUPPORTED_BUILDING_ID && ' · unavailable'}</small></span>{building.id === SUPPORTED_BUILDING_ID && <Check size={18} aria-hidden="true" />}</button>)}</div><p className="mi-help">Only J18 is currently available.</p><button type="button" className="mi-clear-building" onClick={() => { setFilterOpen(false); filterButton.current?.focus({ preventScroll: true }); }}>Close building filter</button></section>
    <div className="mi-map-view" role="group" aria-label="Mapping presentation"><button aria-pressed={mapView === 'scene'} onClick={() => setMapView('scene')}>3D & rooms</button><button aria-pressed={mapView === 'rooms'} onClick={() => { endInteraction(); setMapView('rooms'); }}><List size={18} aria-hidden="true" />Room list</button></div>
    <div className="mi-map-layout" data-map-view={mapView}>
      <section className="mi-scene-pane" aria-label="Schematic room scene" hidden={mapView === 'rooms'}>
        <div className="mi-scene-wrap">
          <canvas ref={canvas} className={`mi-scene${interacting ? ' is-interacting' : ''}`} aria-label="Schematic three-dimensional room scene. Use the room list for accessible room selection." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp} />
          {!failure && <div className="mi-scene-labels" aria-hidden="true">{labels.filter(item => item.visible).map(label => { const room = summaries.find(item => item.id === label.id); return <span key={label.id} className={`mi-scene-label ${selectedId === label.id ? 'is-selected' : ''}`} style={{ left: iosPresentation ? undefined : `${label.x}%`, '--mi-scene-label-x': `${label.x}%`, top: `${label.y}%` }}>{room?.label}<b>{room?.total ?? 0}</b></span>; })}</div>}
          <span className="mi-schematic">Illustrative geometry · not surveyed</span>
          {failure && <div className="mi-scene-fallback" role="status"><MapPin size={26} /><strong>Use the room list</strong><p>{failure}</p></div>}
        </div>
        <div className="mi-map-interaction"><span>{interacting ? 'Drag to rotate · pinch to zoom · two fingers to pan' : 'Tap a room. Page scrolling remains available.'}</span><button type="button" className={interacting ? 'mi-primary' : ''} disabled={!!failure} aria-pressed={interacting} onClick={() => { if (interacting) endInteraction(); else { points.current.clear(); gesture.current = null; setInteracting(true); } }}>{interacting ? 'Finish exploring' : 'Explore 3D'}</button></div>
        {interacting && <div className="mi-map-controls" aria-label="Scene controls"><button onClick={() => moveCamera(defaultMappingCamera())}><RotateCcw size={18} />Reset view</button><button aria-label="Rotate scene left" disabled={!!failure} onClick={() => moveCamera({ yaw: camera.current.yaw - .25 })}><ChevronLeft size={20} /></button><button aria-label="Rotate scene right" disabled={!!failure} onClick={() => moveCamera({ yaw: camera.current.yaw + .25 })}><ChevronRight size={20} /></button><button aria-label="Zoom out" disabled={!!failure} onClick={() => moveCamera({ zoom: clamp(camera.current.zoom - .2, .55, 2.8) })}><Minus size={18} /></button><button aria-label="Zoom in" disabled={!!failure} onClick={() => moveCamera({ zoom: clamp(camera.current.zoom + .2, .55, 2.8) })}><Plus size={18} /></button></div>}
        <details className="mi-map-evidence"><summary>Scene options</summary><div className="mi-map-help"><label><input type="checkbox" checked={simpleEffects} onChange={event => { setSimpleEffects(event.target.checked); sceneMemory.set(memoryKey, { camera: camera.current, selectedId, simpleEffects: event.target.checked, roomSearch }); }} />Simpler effects</label></div></details>
      </section>
      <section className="mi-room-pane" aria-label="Room records">
        {summary && <section className="mi-room-summary" aria-label={`Selected room: ${summary.label}`}><div className="mi-summary-title"><strong>Selected room</strong><button className="mi-icon-button" aria-label="Dismiss room summary" onClick={() => { setSummaryOpen(false); setSelectedId(null); }}><X size={20} /></button></div>{summaryContent()}<button className="mi-primary" onClick={openRecords}><List size={18} />View room records</button></section>}
        <section className="mi-direct-rooms" aria-label="Direct room list"><div className="mi-summary-title"><h3>Find a room</h3>{roomSearch && <button onClick={() => setRoomSearch('')}>Clear search</button>}</div><label className="mi-field">Search rooms<input value={roomSearch} onChange={event => setRoomSearch(event.target.value)} placeholder="Room name or number" /></label><div className="mi-room-list">{filteredRooms.map(room => <button key={room.id} aria-pressed={selectedId === room.id} onClick={() => chooseRoom(room.id)}><MapPin size={18} /><span><strong>{room.label}</strong><small>{room.id === UNKNOWN_MAPPING_ROOM ? 'Missing, unusable or outside-map observations' : `${room.number}${room.placeholder ? ' · Placeholder' : ''}`}</small></span><b>{room.total}</b><ChevronRight size={18} aria-hidden="true" /></button>)}</div>{!filteredRooms.length && <p>No rooms match this search.</p>}</section>
      </section>
    </div>
    <p className="mi-evidence-note">Counts describe recorded observations and loans, not live physical sensing. Viewing the map captures no location.</p>
    {active && !wide && summaryOpen && summary && <PhoneTaskDialog title="Room summary" size="summary" onClose={() => setSummaryOpen(false)} actions={<button className="mi-primary" onClick={openRecords}>View room records<ChevronRight size={19} aria-hidden="true" /></button>}>{summaryContent()}</PhoneTaskDialog>}
  </section>;
}
