import {
  blankArea,
  type AreaDef,
  type PropType,
  type Tile,
  TILE_CHARS,
  addPortal,
  addProp,
  removeAt,
  setTile,
  validateArea,
} from './area';
import './editor.css';

export interface EditorHandle {
  container: HTMLElement;
  getAreas: () => AreaDef[];
  getActiveId: () => string;
  onSelectArea: (id: string) => void;
  onAreasChanged: (areas: AreaDef[]) => void;
  onJump: (areaId: string, gx: number, gz: number) => void;
  /** Screen NDC -> grid cell, resolved against the real iso camera in main. */
  pickTile: (ndcX: number, ndcY: number) => { gx: number; gz: number } | null;
  registerRefresh: (fn: () => void) => void;
}

type Tool =
  | { kind: 'tile'; tile: Tile }
  | { kind: 'prop'; prop: PropType }
  | { kind: 'portal' }
  | { kind: 'erase' };

const TILE_LABELS: Record<Tile, string> = {
  '.': 'Void',
  '#': 'Walkway',
  '@': 'Plaza',
};

const PROP_LABELS: Record<PropType, string> = {
  bbs: 'BBS',
  mystery: 'Mystery Data',
  pylon: 'Nav Post',
  avatar: 'Avatar',
};

/**
 * World-build editor: an overlay menu that paints tiles, places props and links
 * teleport portals. Edits apply to the live world and persist to localStorage.
 */
export function mountEditor(h: EditorHandle): void {
  let tool: Tool = { kind: 'tile', tile: '#' };
  let open = false;
  let selectedProp: PropType = 'bbs';
  let portalTarget: { area: string; gx: number; gz: number } | null = null;
  let portalPicking = false;
  let portalSource: { gx: number; gz: number } | null = null;

  const root = document.createElement('div');
  root.className = 'editor-panel';
  root.dataset.open = 'false';
  h.container.appendChild(root);

  const render = () => {
    const area = h.getAreas().find((a) => a.id === h.getActiveId());
    if (!area) return;
    const problems = validateArea(area);
    const portals = area.portals;
    root.dataset.open = String(open);

    root.innerHTML = `
      <header class="ed-head">
        <strong>World Editor</strong>
        <button class="ed-toggle" data-act="toggle">${open ? 'Close' : 'Open'}</button>
      </header>
      ${
        open
          ? `
      <section class="ed-body">
        <label class="ed-row">
          <span>Area</span>
          <select data-act="area">
            ${h
              .getAreas()
              .map((a) => `<option value="${a.id}" ${a.id === area.id ? 'selected' : ''}>${a.name}</option>`)
              .join('')}
          </select>
        </label>
        <p class="ed-note">${area.note ?? ''}</p>

        <h4>Tiles</h4>
        <div class="ed-grid">
          ${TILE_CHARS.map(
            (t) => `
            <button class="ed-tool ${tool.kind === 'tile' && tool.tile === t ? 'on' : ''}"
              data-tile="${t}" title="${TILE_LABELS[t]}">
              <b>${t}</b><span>${TILE_LABELS[t]}</span>
            </button>`,
          ).join('')}
          <button class="ed-tool ${tool.kind === 'erase' ? 'on' : ''}" data-act="erase">
            <b>⌫</b><span>Erase</span>
          </button>
        </div>

        <h4>Props</h4>
        <div class="ed-grid">
          ${(Object.keys(PROP_LABELS) as PropType[])
            .map(
              (p) => `
            <button class="ed-tool ${tool.kind === 'prop' && tool.prop === p ? 'on' : ''}"
              data-prop="${p}"><b>◆</b><span>${PROP_LABELS[p]}</span></button>`,
            )
            .join('')}
        </div>

        <h4>Teleport portal</h4>
        <button class="ed-tool wide ${tool.kind === 'portal' ? 'on' : ''}" data-act="portal">
          <b>◎</b><span>${portalPicking ? 'Click destination cell…' : 'Link portal'}</span>
        </button>
        <div class="ed-row">
          <span>Target</span>
          <select data-act="target">
            ${h
              .getAreas()
              .map((a) => `<option value="${a.id}" ${portalTarget?.area === a.id ? 'selected' : ''}>${a.name}</option>`)
              .join('')}
          </select>
        </div>
        <div class="ed-row">
          <span>Cell</span>
          <input data-act="tx" type="number" min="0" value="${portalTarget?.gx ?? 0}" />
          <input data-act="tz" type="number" min="0" value="${portalTarget?.gz ?? 0}" />
        </div>
        ${
          portals.length
            ? `<ul class="ed-list">${portals
                .map(
                  (p) =>
                    `<li><code>${p.gx},${p.gz}</code> → ${p.to.area} <code>${p.to.gx},${p.to.gz}</code>
                     <button data-del-portal="${p.gx},${p.gz}" title="Remove">×</button></li>`,
                )
                .join('')}</ul>`
            : '<p class="ed-note">No portals in this area.</p>'
        }

        <h4>Area</h4>
        <div class="ed-row ed-actions">
          <button data-act="export">Export JSON</button>
          <button data-act="import">Import JSON</button>
          <button data-act="new">New area</button>
          <button data-act="reset">Reset all</button>
        </div>
        ${
          problems.length
            ? `<ul class="ed-problems">${problems.slice(0, 4).map((p) => `<li>${p}</li>`).join('')}</ul>`
            : '<p class="ed-ok">✓ Area valid</p>'
        }
      </section>`
          : ''
      }
      <div class="ed-status">${open ? `Paint mode: ${tool.kind}` : 'Press E to edit'}</div>
    `;
  };

  const apply = (next: AreaDef) => {
    h.onAreasChanged(h.getAreas().map((a) => (a.id === next.id ? next : a)));
    render();
  };

  const currentArea = () => h.getAreas().find((a) => a.id === h.getActiveId());

  // --- Click handling on the panel ----------------------------------------
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tile],[data-prop],[data-del-portal]');
    if (!el) return;
    const area = currentArea();
    if (!area) return;

    if (el.dataset.tile) {
      tool = { kind: 'tile', tile: el.dataset.tile as Tile };
      render();
      return;
    }
    if (el.dataset.prop) {
      selectedProp = el.dataset.prop as PropType;
      tool = { kind: 'prop', prop: selectedProp };
      render();
      return;
    }
    if (el.dataset.delPortal) {
      const [gx, gz] = el.dataset.delPortal.split(',').map(Number);
      apply({ ...area, portals: area.portals.filter((p) => !(p.gx === gx && p.gz === gz)) });
      return;
    }

    switch (el.dataset.act) {
      case 'toggle':
        open = !open;
        render();
        break;
      case 'erase':
        tool = { kind: 'erase' };
        render();
        break;
      case 'portal':
        portalPicking = !portalPicking;
        if (!portalPicking) portalSource = null;
        tool = { kind: 'portal' };
        render();
        break;
      case 'export': {
        const blob = new Blob([JSON.stringify(h.getAreas(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mmbn-areas.json';
        a.click();
        URL.revokeObjectURL(url);
        break;
      }
      case 'import': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const parsed = JSON.parse(await file.text()) as AreaDef[];
            if (Array.isArray(parsed) && parsed.length > 0) h.onAreasChanged(parsed);
          } catch {
            alert('Import failed: not a valid area JSON file.');
          }
        };
        input.click();
        break;
      }
      case 'new': {
        const id = `area-${Date.now().toString(36)}`;
        const size = area.tiles[0]!.length;
        const created = blankArea(id, `New Area ${h.getAreas().length + 1}`, size, area.tiles.length);
        h.onAreasChanged([...h.getAreas(), created]);
        h.onSelectArea(id);
        break;
      }
      case 'reset': {
        localStorage.removeItem('mmbn.areas.v1');
        location.reload();
        break;
      }
    }
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target as HTMLSelectElement | HTMLInputElement;
    const act = el.dataset.act;
    if (!act) return;
    const area = currentArea();
    if (!area) return;
    if (act === 'area') {
      h.onSelectArea(el.value);
      render();
      return;
    }
    if (act === 'target') {
      portalTarget = { area: el.value, gx: portalTarget?.gx ?? 0, gz: portalTarget?.gz ?? 0 };
    }
    if (act === 'tx' && portalTarget) portalTarget = { ...portalTarget, gx: Number(el.value) };
    if (act === 'tz' && portalTarget) portalTarget = { ...portalTarget, gz: Number(el.value) };
  });

  // --- Painting on the 3D canvas ------------------------------------------
  const canvas = h.container.parentElement?.querySelector('canvas');
  canvas?.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas?.addEventListener('pointerdown', (ev) => {
    if (!open) return;
    const area = currentArea();
    if (!area) return;
    const cell = pickCell(ev as PointerEvent);
    if (!cell) return;
    const { gx, gz } = cell;

    if (tool.kind === 'tile') {
      apply(setTile(area, gx, gz, tool.tile));
    } else if (tool.kind === 'erase') {
      apply(removeAt(setTile(area, gx, gz, '.'), gx, gz));
    } else if (tool.kind === 'prop') {
      apply(addProp(area, tool.prop, gx, gz));
    } else if (tool.kind === 'portal') {
      if (!portalSource) {
        portalSource = { gx, gz };
        portalPicking = true;
        render();
        return;
      }
      const target = portalTarget ?? { area: area.id, gx: 0, gz: 0 };
      apply(
        addPortal(area, {
          gx: portalSource.gx,
          gz: portalSource.gz,
          to: { area: target.area, gx: target.gx, gz: target.gz },
          label: `To ${target.area}`,
        }),
      );
      portalSource = null;
      portalPicking = false;
    }
  });

  /** Maps a screen click to a tile via the host's camera-accurate picker. */
  function pickCell(ev: PointerEvent): { gx: number; gz: number } | null {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    return h.pickTile(ndcX, ndcY);
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyE' && !ev.metaKey && !ev.ctrlKey) {
      open = !open;
      render();
    }
    if (ev.code === 'Escape' && portalPicking) {
      portalPicking = false;
      portalSource = null;
      render();
    }
  });

  h.registerRefresh(render);
  render();
}
