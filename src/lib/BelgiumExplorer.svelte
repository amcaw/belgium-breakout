<script>
  import { geoMercator, geoPath } from 'd3-geo';
  import { interpolateYlGnBu } from 'd3-scale-chromatic';
  import { base } from '$app/paths';

  let { geojson } = $props();

  const W = 1000;
  const H = 1080;

  const setup = (() => {
    const features = geojson.features;
    const maxPop = Math.max(...features.map((f) => f.properties?.population ?? 0));
    const projection = geoMercator().fitExtent(
      [
        [16, 16],
        [W - 16, H - 16]
      ],
      geojson
    );
    const path = geoPath(projection);
    const cells = features
      .map((f) => {
        const b = path.bounds(f);
        const p = f.properties ?? {};
        return {
          id: String(p.nis ?? p.name_fr),
          d: path(f),
          x: b[0][0],
          y: b[0][1],
          w: b[1][0] - b[0][0],
          h: b[1][1] - b[0][1],
          cx: (b[0][0] + b[1][0]) / 2,
          cy: (b[0][1] + b[1][1]) / 2,
          name: p.name_fr ?? p.name_nl ?? '?',
          nameNl: p.name_nl ?? '',
          pop: p.population ?? 0,
          nis: p.nis ?? '',
          col: p.grid_col,
          row: p.grid_row,
          lat: p.centroid_lat,
          lon: p.centroid_lon
        };
      })
      .filter((c) => Number.isFinite(c.x) && c.w > 0 && c.h > 0);
    return { maxPop, cells };
  })();

  const { maxPop, cells } = setup;
  const popColor = (pop) => interpolateYlGnBu(0.12 + (Math.sqrt(pop) / Math.sqrt(maxPop)) * 0.82);

  const topIds = new Set(
    [...cells]
      .sort((a, b) => b.pop - a.pop)
      .slice(0, 12)
      .map((c) => c.id)
  );

  const norm = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

  let query = $state('');
  let showAll = $state(false);
  /** @type {any} */
  let hovered = $state(null);
  /** @type {any} */
  let pinned = $state(null);

  const q = $derived(norm(query.trim()));
  const matches = $derived(
    q.length < 2 ? new Set() : new Set(cells.filter((c) => norm(c.name).includes(q) || norm(c.nameNl).includes(q)).map((c) => c.id))
  );
  const active = $derived(pinned ?? hovered);
  const fmt = new Intl.NumberFormat('fr-BE');

  function labelShown(c) {
    if (showAll) return true;
    if (matches.has(c.id)) return true;
    if (active && active.id === c.id) return true;
    return q.length < 2 && matches.size === 0 && topIds.has(c.id);
  }
</script>

<div class="explorer">
  <header class="bar">
    <div class="head">
      <h1>Carte des communes</h1>
      <span class="sub">{cells.length} communes · grille (cartogramme), pas la géographie réelle</span>
    </div>
    <div class="controls">
      <input
        class="search"
        type="search"
        placeholder="Chercher une commune (ex. Charleroi)…"
        bind:value={query}
      />
      <label class="toggle">
        <input type="checkbox" bind:checked={showAll} />
        Tous les noms
      </label>
      <a class="back" href="{base}/">← Jeu</a>
    </div>
  </header>

  <div class="stage">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Carte des communes de Belgique">
      {#each cells as c (c.id)}
        <path
          d={c.d}
          fill={matches.has(c.id) ? 'var(--accent)' : popColor(c.pop)}
          stroke="var(--bg)"
          stroke-width="0.6"
          opacity={q.length >= 2 && !matches.has(c.id) ? 0.25 : 1}
          class:active={active && active.id === c.id}
          role="presentation"
          onmouseenter={() => (hovered = c)}
          onmouseleave={() => (hovered = null)}
          onclick={() => (pinned = pinned && pinned.id === c.id ? null : c)}
        />
      {/each}

      {#each cells as c (c.id + '-l')}
        {#if labelShown(c)}
          <text
            class="label"
            class:match={matches.has(c.id)}
            x={c.cx}
            y={c.cy}
            text-anchor="middle"
            dominant-baseline="central"
            font-size={Math.max(7, Math.min(13, c.w * 0.22))}
          >{c.name}</text>
        {/if}
      {/each}
    </svg>

    {#if active}
      <aside class="detail">
        <h2>{active.name}</h2>
        {#if active.nameNl && active.nameNl !== active.name}<p class="nl">{active.nameNl}</p>{/if}
        <dl>
          <div><dt>Population</dt><dd>{fmt.format(active.pop)}</dd></div>
          <div><dt>Code NIS</dt><dd>{active.nis}</dd></div>
          <div><dt>Grille (col, ligne)</dt><dd>{active.col}, {active.row}</dd></div>
          <div><dt>Centroïde réel</dt><dd>{active.lat?.toFixed(4)}, {active.lon?.toFixed(4)}</dd></div>
        </dl>
        <p class="hint">{pinned ? 'Épinglé · reclique pour libérer' : 'Survole ou clique pour épingler'}</p>
      </aside>
    {/if}
  </div>
</div>

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100dvh;
    color: var(--text);
    font-family: var(--font);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 1.25rem;
    padding: 0.7rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .head h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
  }
  .head .sub {
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .search {
    min-width: 240px;
    padding: 7px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font: 500 0.9rem var(--font);
    outline: none;
  }
  .search:focus {
    border-color: var(--accent);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .back {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .back:hover {
    border-color: var(--accent);
  }

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  path {
    cursor: pointer;
    transition:
      opacity 0.12s,
      fill 0.12s;
  }
  path.active {
    stroke: var(--text);
    stroke-width: 2;
  }
  .label {
    fill: var(--text);
    font-weight: 600;
    paint-order: stroke fill;
    stroke: var(--bg);
    stroke-width: 2.4;
    pointer-events: none;
  }
  .label.match {
    fill: var(--accent-contrast);
    stroke: var(--accent);
  }

  .detail {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 240px;
    max-width: calc(100% - 28px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px 16px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  }
  .detail h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }
  .detail .nl {
    margin: 2px 0 0;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .detail dl {
    margin: 12px 0 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .detail dl div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.82rem;
  }
  .detail dt {
    color: var(--text-muted);
  }
  .detail dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .detail .hint {
    margin: 12px 0 0;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  @media (max-width: 560px) {
    .search {
      min-width: 0;
      flex: 1;
    }
    .detail {
      width: auto;
      left: 14px;
      right: 14px;
    }
  }
</style>
