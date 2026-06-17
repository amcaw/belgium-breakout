<script>
  import { geoMercator, geoPath } from 'd3-geo';
  import { interpolateYlGnBu } from 'd3-scale-chromatic';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { initPym, sendHeight } from '$lib/pym.js';

  let { geojson } = $props();

  initPym();

  const W = 800;
  const H = 900;
  const WALL = 6;
  const ASPECT = W / H;

  const heat = (t) => interpolateYlGnBu(0.15 + t * 0.8);

  const setup = (() => {
    const features = geojson.features;
    const maxPop = Math.max(...features.map((f) => f.properties?.population ?? 0));

    const projection = geoMercator().fitExtent(
      [
        [WALL + 10, 56],
        [W - WALL - 10, H - 210]
      ],
      geojson
    );
    const path = geoPath(projection);

    const rankByNis = new Map(
      [...features]
        .sort((a, b) => (b.properties?.population ?? 0) - (a.properties?.population ?? 0))
        .map((f, i) => [String(f.properties?.nis), i + 1])
    );

    const initialBricks = features
      .map((f) => {
        const b = path.bounds(f);
        const x = b[0][0];
        const y = b[0][1];
        const w = b[1][0] - x;
        const h = b[1][1] - y;
        const pop = f.properties?.population ?? 0;
        const name = f.properties?.name_fr ?? f.properties?.name_nl ?? '?';
        return {
          id: String(f.properties?.nis ?? name),
          x: x + 0.9,
          y: y + 0.9,
          w: Math.max(1, w - 1.8),
          h: Math.max(1, h - 1.8),
          cx: x + w / 2,
          cy: y + h / 2,
          name,
          pop,
          rank: rankByNis.get(String(f.properties?.nis)) ?? 0,
          alive: true
        };
      })
      .filter((b) => Number.isFinite(b.x) && Number.isFinite(b.w) && b.w > 0 && b.h > 0);

    const totalPop = initialBricks.reduce((s, b) => s + b.pop, 0);
    const topCity = initialBricks.reduce((a, b) => (b.pop > a.pop ? b : a), initialBricks[0]);
    return { maxPop, initialBricks, totalPop, topCity };
  })();

  const { maxPop, initialBricks, totalPop, topCity } = setup;
  const popColor = (pop) => heat(Math.sqrt(pop) / Math.sqrt(maxPop));

  let bricks = $state(initialBricks.map((b) => ({ ...b })));
  let score = $state(0);
  let lives = $state(3);
  let aliveCount = $state(initialBricks.length);
  const totalBricks = initialBricks.length;

  let phase = $state('ready');
  let combo = $state(0);
  let paused = $state(false);

  let mode = $state(null);

  function chooseMode(m) {
    mode = m;
    launchBall();
  }

  function togglePause() {
    if (phase === 'playing') paused = !paused;
  }

  let destroyed = $state([]);
  let destroyedSeq = 0;
  let freedCount = $state(0);
  let freedPop = $state(0);

  const popPct = $derived(
    !totalPop ? 0 : freedPop >= totalPop ? 100 : Math.min(99, Math.floor((freedPop / totalPop) * 100))
  );

  let mission = $state(null);
  let missionsDone = $state(0);
  let missionFlash = $state(0);
  const MISSION_BONUS = 2000;

  function pickMission() {
    const alive = bricks.filter((b) => b.alive);
    if (alive.length === 0) {
      mission = null;
      return;
    }

    const pool = alive.length > 30 ? alive.filter((b) => b.pop > 8000) : alive;
    const from = pool.length ? pool : alive;

    const idx = (destroyedSeq * 7 + missionsDone * 31 + alive.length) % from.length;
    const t = from[idx];
    mission = { id: t.id, name: t.name, pop: t.pop };
  }

  const paddleW = 132;
  const paddleH = 13;
  const paddleY = H - 64;
  let paddleX = $state(W / 2 - paddleW / 2);

  const R = 9;
  const BASE_SPEED = 7.2;
  const MAX_BALLS = 3;
  let ballSeq = 0;
  function makeBall(x, y, vx = 0, vy = 0) {
    return { id: ballSeq++, x, y, vx, vy, trail: [] };
  }
  let balls = $state([makeBall(W / 2, paddleY - R - 2)]);

  let particles = $state([]);
  let popups = $state([]);
  let popupSeq = 0;

  const PANEL_W = 320;
  const STACK_PANEL_H = 132;
  const WIDE_AT = 720;

  let rootEl;
  let hudEl;
  let missionEl = $state();
  let tickerEl;
  let boardW = $state(W);
  let boardH = $state(H);
  let boxWidth = $state(W);
  let boxHeight = $state(H);
  let wide = $state(true);

  function fitBoard() {
    if (!rootEl) return;
    const availW = rootEl.clientWidth;
    const availH = rootEl.clientHeight;
    if (availW <= 0 || availH <= 0) return;
    wide = availW >= WIDE_AT;

    const chromeH =
      (hudEl?.offsetHeight ?? 0) + (missionEl?.offsetHeight ?? 0) + (tickerEl?.offsetHeight ?? 0);
    const boxW = Math.max(1, wide ? availW - PANEL_W : availW);
    const boxH = Math.max(1, availH - chromeH - (wide ? 0 : STACK_PANEL_H));

    const FRAME = 10;
    let bw = (boxH - 2 * FRAME) * ASPECT;
    if (bw > boxW - 2 * FRAME) bw = boxW - 2 * FRAME;
    boardW = Math.max(1, bw);
    boardH = Math.max(1, boardW / ASPECT);

    boxWidth = boxW;
    boxHeight = boxH;
  }

  let svgEl;
  let raf = 0;

  function launchBall() {
    if (phase === 'won' || phase === 'lost') {
      resetGame();
      return;
    }

    if (phase === 'ready' && mode) {
      const angle = -Math.PI / 2 + (Math.random() * 0.6 - 0.3);
      const b0 = balls[0];
      b0.vx = Math.cos(angle) * BASE_SPEED;
      b0.vy = Math.sin(angle) * BASE_SPEED;
      phase = 'playing';
      paused = false;
      combo = 0;
      if (mode === 'objective' && !mission) pickMission();
    }
  }

  function ballSpeed() {
    return Math.min(BASE_SPEED + score / 45000, 12.5);
  }

  function spawnExtraBall(x, y) {
    if (balls.length >= MAX_BALLS) return;
    const speed = ballSpeed();
    const angle = -Math.PI / 2 + (Math.random() * 1.2 - 0.6);
    balls.push(makeBall(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed));
    spawnPopup(x, y, 'BALLE BONUS');
  }

  function resetGame() {
    bricks = initialBricks.map((b) => ({ ...b }));
    aliveCount = totalBricks;
    score = 0;
    lives = 3;
    combo = 0;
    particles = [];
    popups = [];
    destroyed = [];
    freedCount = 0;
    freedPop = 0;
    mission = null;
    missionsDone = 0;
    mode = null;
    paused = false;
    resetBall();
    phase = 'ready';
  }

  function resetBall() {
    balls = [makeBall(paddleX + paddleW / 2, paddleY - R - 2)];
  }

  function spawnParticles(cx, cy, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3.2;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function spawnPopup(cx, cy, text) {
    popups.push({ key: popupSeq++, x: cx, y: cy, text, life: 1 });
    if (popups.length > 30) popups.splice(0, popups.length - 30);
  }

  function pointerToField(clientX) {
    if (!svgEl) return paddleX;
    const rect = svgEl.getBoundingClientRect();
    const fx = ((clientX - rect.left) / rect.width) * W;
    return Math.max(WALL, Math.min(W - WALL - paddleW, fx - paddleW / 2));
  }
  function idleBallToPaddle() {
    if (phase === 'ready' && balls[0]) balls[0].x = paddleX + paddleW / 2;
  }
  function onMouseMove(e) {
    paddleX = pointerToField(e.clientX);
    idleBallToPaddle();
  }
  function onTouchMove(e) {
    if (e.touches[0]) {
      paddleX = pointerToField(e.touches[0].clientX);
      idleBallToPaddle();
      e.preventDefault();
    }
  }
  function onTouchStart(e) {
    if (e.touches[0]) {
      paddleX = pointerToField(e.touches[0].clientX);
      idleBallToPaddle();
    }
    launchBall();
    e.preventDefault();
  }
  function onKey(e) {
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      togglePause();
      e.preventDefault();
      return;
    }
    const step = 36;
    if (e.key === 'ArrowLeft') paddleX = Math.max(WALL, paddleX - step);
    else if (e.key === 'ArrowRight') paddleX = Math.min(W - WALL - paddleW, paddleX + step);
    else if (e.key === ' ' || e.key === 'Enter') {
      launchBall();
      e.preventDefault();
    }
    idleBallToPaddle();
  }

  function hitBrick(ball, b) {
    const nx = Math.max(b.x, Math.min(ball.x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(ball.y, b.y + b.h));
    const dx = ball.x - nx;
    const dy = ball.y - ny;
    if (dx * dx + dy * dy > R * R) return false;
    const overlapL = ball.x + R - b.x;
    const overlapR = b.x + b.w - (ball.x - R);
    const overlapT = ball.y + R - b.y;
    const overlapB = b.y + b.h - (ball.y - R);
    const minX = Math.min(overlapL, overlapR);
    const minY = Math.min(overlapT, overlapB);
    if (minX < minY) ball.vx = -ball.vx;
    else ball.vy = -ball.vy;
    return true;
  }

  function breakBrick(b, ball) {
    b.alive = false;
    aliveCount -= 1;
    combo += 1;
    let gain = 50 + Math.round(b.pop / 100) + combo * 25;

    const isMission = mission && b.id === mission.id;
    if (isMission) {
      gain += MISSION_BONUS;
      missionsDone += 1;
      mission = null;
      missionFlash = 1;
    }
    score += gain;
    freedCount += 1;
    freedPop += b.pop;

    destroyed.unshift({
      key: destroyedSeq++,
      name: b.name,
      pop: b.pop,
      rank: b.rank,
      points: gain
    });
    if (destroyed.length > 60) destroyed.length = 60;

    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    spawnParticles(cx, cy, popColor(b.pop), (isMission ? 18 : 8) + (combo > 3 ? 6 : 0));
    if (combo >= 2) spawnPopup(cx, cy, `×${combo}`);

    if (b.rank > 0 && b.rank <= 15) spawnExtraBall(ball.x, ball.y);
    else if (combo === 8) spawnExtraBall(ball.x, ball.y);
    if (isMission) spawnExtraBall(ball.x, ball.y);

    if (aliveCount <= 0) {
      phase = 'won';
      score += lives * 5000;
    } else if (mode === 'objective' && !mission) {
      pickMission();
    }
  }

  function tick() {
    if (phase === 'playing' && !paused) {
      for (const ball of balls) {
        ball.x += ball.vx;
        ball.y += ball.vy;

        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 14) ball.trail.shift();

        if (ball.x - R < WALL) {
          ball.x = WALL + R;
          ball.vx = Math.abs(ball.vx);
        } else if (ball.x + R > W - WALL) {
          ball.x = W - WALL - R;
          ball.vx = -Math.abs(ball.vx);
        }
        if (ball.y - R < WALL) {
          ball.y = WALL + R;
          ball.vy = Math.abs(ball.vy);
        }

        if (
          ball.vy > 0 &&
          ball.y + R >= paddleY &&
          ball.y - R <= paddleY + paddleH &&
          ball.x >= paddleX - R &&
          ball.x <= paddleX + paddleW + R
        ) {
          const rel = (ball.x - (paddleX + paddleW / 2)) / (paddleW / 2);
          const angle = -Math.PI / 2 + rel * (Math.PI / 3);
          const speed = ballSpeed();
          ball.vx = Math.cos(angle) * speed;
          ball.vy = Math.sin(angle) * speed;
          ball.y = paddleY - R - 1;
          combo = 0;
        }

        for (const b of bricks) {
          if (!b.alive) continue;
          if (
            ball.x + R < b.x ||
            ball.x - R > b.x + b.w ||
            ball.y + R < b.y ||
            ball.y - R > b.y + b.h
          )
            continue;
          if (hitBrick(ball, b)) {
            breakBrick(b, ball);
            break;
          }
        }
      }

      const fell = balls.filter((ball) => ball.y - R > H);
      if (fell.length) {
        balls = balls.filter((ball) => ball.y - R <= H);
        if (balls.length === 0) {
          lives -= 1;
          if (lives <= 0) phase = 'lost';
          else {
            phase = 'ready';
            resetBall();
          }
        }
      }
    }

    if (particles.length) {
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.life -= 0.025;
      }
      particles = particles.filter((p) => p.life > 0);
    }

    if (popups.length) {
      for (const p of popups) {
        p.y -= 0.9;
        p.life -= 0.018;
      }
      popups = popups.filter((p) => p.life > 0);
    }

    if (missionFlash > 0) missionFlash = Math.max(0, missionFlash - 0.02);

    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    fitBoard();
    const ro = new ResizeObserver(fitBoard);
    if (rootEl) ro.observe(rootEl);
    if (hudEl) ro.observe(hudEl);
    if (missionEl) ro.observe(missionEl);
    if (tickerEl) ro.observe(tickerEl);
    raf = requestAnimationFrame(tick);
    const onHide = () => {
      if (document.hidden && phase === 'playing') paused = true;
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onHide);
    };
  });

  $effect(() => {
    void mode;
    void phase;
    requestAnimationFrame(fitBoard);
    sendHeight();
  });

  const pct = $derived(
    aliveCount <= 0 ? 100 : Math.min(99, Math.floor(((totalBricks - aliveCount) / totalBricks) * 100))
  );
  const fmt = {
    format(n) {
      const v = Math.round(n);
      if (v < 10000) return String(v);
      return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
  };

  const legend = $derived([0, 0.25, 0.5, 0.75, 1].map((t) => heat(t)));
</script>

<svelte:window onmousemove={onMouseMove} onkeydown={onKey} />

<div class="game" bind:this={rootEl}>
  <header class="hud" bind:this={hudEl}>
    <div class="title">
      <h1>Belgium Breakout</h1>
      <div class="legend" aria-hidden="true">
        <span class="legend-label">Population</span>
        <span class="swatches">
          {#each legend as c}<span class="sw" style:background={c}></span>{/each}
        </span>
        <span class="legend-ends"><span>faible</span><span>élevée</span></span>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="label">Score</span>
        <span class="value score">{fmt.format(score)}</span>
      </div>
      <div class="stat">
        <span class="label">Vies</span>
        <span class="value hearts">
          {'♥'.repeat(Math.max(0, lives))}<span class="dim">{'♡'.repeat(Math.max(0, 3 - lives))}</span>
        </span>
      </div>
      <div class="stat">
        <span class="label">Combo</span>
        <span class="value combo" class:hot={combo > 3}>×{combo}</span>
      </div>
      <div class="stat progress">
        <span class="label">Communes {pct}% · Population {popPct}%</span>
        <span class="bar" title="Communes libérées">
          <span class="fill" style:width={`${pct}%`}></span>
        </span>
        <span class="bar pop" title="Part de la population belge libérée">
          <span class="fill" style:width={`${popPct}%`}></span>
        </span>
      </div>
    </div>
  </header>

  {#if mode === 'objective'}
    <div
      class="mission"
      class:flash={missionFlash > 0}
      class:none={!mission}
      bind:this={missionEl}
      aria-live="polite"
    >
      {#if mission}
        <span class="target">Objectif</span>
        <span class="mname">{mission.name}</span>
        <span class="mpop">{fmt.format(mission.pop)} hab.</span>
        <span class="mbonus">+{fmt.format(MISSION_BONUS)}</span>
      {:else if missionsDone > 0}
        <span class="target done">Objectif accompli</span>
      {:else}
        <span class="target">Lance la balle pour recevoir un objectif</span>
      {/if}
    </div>
  {/if}

  <div class="stage" class:wide>
    <div class="board" style:width={`${boxWidth}px`} style:height={`${boxHeight}px`}>
      <svg
        bind:this={svgEl}
        width={boardW}
        height={boardH}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label="Belgium Breakout"
        ontouchmove={onTouchMove}
      >
        <defs>
          <clipPath id="ballClip">
            <circle cx="0" cy="0" r={R} />
          </clipPath>
          <radialGradient id="ballGloss" cx="35%" cy="30%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.65" />
            <stop offset="45%" stop-color="#ffffff" stop-opacity="0.1" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.25" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="var(--board-bg)" />

        {#each bricks as b (b.id)}
          {#if b.alive}
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx="2"
              fill={popColor(b.pop)}
              stroke="var(--brick-stroke)"
              stroke-width="0.8"
            />
          {/if}
        {/each}

        {#if mission}
          {@const mb = bricks.find((b) => b.id === mission.id && b.alive)}
          {#if mb}
            <rect
              class="mission-mark"
              x={mb.x - 2}
              y={mb.y - 2}
              width={mb.w + 4}
              height={mb.h + 4}
              rx="3"
              fill="none"
              stroke="var(--accent)"
              stroke-width="3"
            />
            <circle class="mission-ping" cx={mb.cx} cy={mb.cy} r={Math.max(mb.w, mb.h)} fill="none" stroke="var(--accent)" stroke-width="2" />
          {/if}
        {/if}

        {#each particles as p}
          <circle cx={p.x} cy={p.y} r={2.2 * p.life + 0.5} fill={p.color} opacity={p.life} />
        {/each}

        <rect
          x={paddleX}
          y={paddleY}
          width={paddleW}
          height={paddleH}
          rx={paddleH / 2}
          fill="var(--paddle)"
        />

        {#each balls as ball (ball.id)}
          {#each ball.trail as t, i}
            <circle
              cx={t.x}
              cy={t.y}
              r={R * (0.3 + (0.6 * i) / ball.trail.length)}
              fill="var(--accent)"
              opacity={(0.28 * (i + 1)) / ball.trail.length}
            />
          {/each}
          <g class="ball" transform={`translate(${ball.x},${ball.y})`}>
            <g clip-path="url(#ballClip)">
              <rect x={-R} y={-R} width={(2 * R) / 3} height={2 * R} fill="#2d2926" />
              <rect x={-R / 3} y={-R} width={(2 * R) / 3} height={2 * R} fill="#fae042" />
              <rect x={R / 3} y={-R} width={(2 * R) / 3} height={2 * R} fill="#ed2939" />
              <circle cx="0" cy="0" r={R} fill="url(#ballGloss)" />
            </g>
            <circle cx="0" cy="0" r={R} fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" />
          </g>
        {/each}

        {#each popups as p (p.key)}
          <text
            class="combo-pop"
            x={p.x}
            y={p.y}
            text-anchor="middle"
            opacity={Math.min(1, p.life * 1.6)}
            font-size={26 + (1 - p.life) * 14}
          >{p.text}</text>
        {/each}

      </svg>
      {#if phase === 'ready' && mode}
        <div class="ready-overlay">
          <span class="ready-title">Prêt ?</span>
          <span class="ready-hint">Clic ou Espace pour lancer</span>
          <span class="ready-hint">Souris ou ← → pour déplacer la raquette</span>
        </div>
      {/if}
      {#if phase === 'won'}
        <div class="result-overlay">
          <span class="result-title win">Belgique libérée !</span>
          <span class="result-sub">Score final : {fmt.format(score)}</span>
          <span class="result-line">Tu as libéré {fmt.format(totalBricks)} communes — toute la Belgique.</span>
          <span class="result-line">
            {fmt.format(totalPop)} habitants{#if mode === 'objective'}{' · '}{missionsDone} objectif{missionsDone > 1 ? 's' : ''} accompli{missionsDone > 1 ? 's' : ''}{/if}
          </span>
          <span class="result-line">La plus peuplée : {topCity.name} ({fmt.format(topCity.pop)})</span>
          <span class="result-cta">Clic pour rejouer</span>
        </div>
      {/if}
      {#if phase === 'lost'}
        <div class="result-overlay">
          <span class="result-title lose">Partie terminée</span>
          <span class="result-sub">{fmt.format(score)} points</span>
          <span class="result-line">{freedCount} communes libérées sur {totalBricks} ({pct}%)</span>
          <span class="result-line">{popPct}% de la population belge libérée</span>
          {#if mode === 'objective'}
            <span class="result-line">{missionsDone} objectif{missionsDone > 1 ? 's' : ''} accompli{missionsDone > 1 ? 's' : ''}</span>
          {/if}
          <span class="result-cta">Clic pour réessayer</span>
        </div>
      {/if}
      {#if phase === 'ready' && !mode}

        <div class="start">
          <h2 class="start-title">Belgium Breakout</h2>
          <p class="start-sub">Choisis ton mode de jeu</p>
          <div class="modes">
            <button class="mode-card" onclick={() => chooseMode('free')}>
              <span class="mode-name">Partie libre</span>
              <span class="mode-desc">
                Libère toutes les communes à ton rythme. Score basé sur la population.
              </span>
            </button>
            <button class="mode-card accent" onclick={() => chooseMode('objective')}>
              <span class="mode-name">Partie à objectifs</span>
              <span class="mode-desc">
                Des communes ciblées apparaissent sur la carte. Trouve-les pour un gros bonus.
              </span>
            </button>
          </div>
          <p class="start-hint">Souris ou ← → pour déplacer la raquette</p>
        </div>
      {:else}
        <button
          class="hit"
          onclick={launchBall}
          ontouchstart={onTouchStart}
          ontouchmove={onTouchMove}
          aria-label="Lancer la balle"
        ></button>
      {/if}

      {#if phase === 'playing'}
        <button
          class="pause-btn"
          onclick={(e) => {
            e.stopPropagation();
            togglePause();
          }}
          ontouchstart={(e) => {
            e.stopPropagation();
            e.preventDefault();
            togglePause();
          }}
          aria-label={paused ? 'Reprendre' : 'Pause'}
        >
          {#if paused}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          {/if}
        </button>
      {/if}

      {#if paused}
        <button
          class="pause-overlay"
          onclick={togglePause}
          ontouchstart={(e) => {
            e.preventDefault();
            togglePause();
          }}
        >
          <span class="pause-title">Pause</span>
          <span class="pause-hint">Clic, P ou Échap pour reprendre</span>
        </button>
      {/if}
    </div>

    <aside class="log" style:height={wide ? `${boxHeight}px` : `${STACK_PANEL_H}px`}>
      <header class="log-head">
        <h2>Communes libérées</h2>
        <span class="log-count">
          {freedCount}<span class="of"> / {totalBricks}</span>
        </span>
      </header>
      <div class="log-sub">
        <span>Population libérée · {popPct}%</span>
        <strong>{fmt.format(freedPop)}</strong>
      </div>
      <ol class="log-list">
        {#each destroyed as d (d.key)}
          <li in:fly={{ y: -14, duration: 260 }} animate:flip={{ duration: 220 }}>
            <span class="dot" style:background={popColor(d.pop)}></span>
            <span class="name">{d.name}</span>
            {#if d.rank <= 20}<span class="rank">#{d.rank}</span>{/if}
            <span class="pop">{fmt.format(d.pop)}</span>
          </li>
        {/each}
        {#if destroyed.length === 0}
          <li class="empty">Aucune commune libérée… pour l'instant.</li>
        {/if}
      </ol>
    </aside>
  </div>

  <p class="ticker" bind:this={tickerEl}>
    {#if destroyed[0]}
      <strong>{destroyed[0].name}</strong>
      libérée · {fmt.format(destroyed[0].pop)} hab.{#if destroyed[0].rank <= 10} · <strong>{destroyed[0].rank}ᵉ</strong> commune la plus peuplée{/if} · +{fmt.format(destroyed[0].points)} pts
    {:else}
      Vise Anvers et Bruxelles — les grandes villes valent le plus de points.
    {/if}
  </p>
</div>

<style>
  .game {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font);
  }

  .hud {
    box-sizing: border-box;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 1.25rem;
    padding: 0.6rem 0.9rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .title h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
  .legend-label {
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .swatches {
    display: inline-flex;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .sw {
    width: 22px;
    height: 9px;
  }
  .legend-ends {
    display: inline-flex;
    gap: 6px;
    font-size: 0.6rem;
    color: var(--text-muted);
  }

  .stats {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 56px;
  }
  .stat.progress {
    min-width: 160px;
    flex: 1 1 160px;
  }
  .label {
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .value {
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .value.score {
    color: var(--accent);
  }
  .value.hearts {
    color: var(--accent);
    letter-spacing: 1px;
  }
  .value.hearts .dim {
    color: var(--accent-soft);
  }
  .value.combo {
    color: var(--text-secondary);
  }
  .value.combo.hot {
    color: var(--accent);
  }
  .bar {
    margin-top: 5px;
    height: 7px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar.pop {
    margin-top: 3px;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.25s ease;
  }

  .bar.pop .fill {
    background: linear-gradient(90deg, var(--accent), #f0a)
  }

  .mission {
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem 0.7rem;
    padding: 6px 12px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--border);
    font-size: 0.86rem;
    transition: background 0.2s ease;
  }
  .mission.flash {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .mission.none {
    color: var(--text-muted);
  }
  .mission .target {
    font-weight: 600;
    color: var(--text-secondary);
  }
  .mission.flash .target,
  .mission .target.done {
    color: inherit;
    font-weight: 700;
  }
  .mission .mname {
    font-weight: 700;
    font-size: 1rem;
    color: var(--accent);
  }
  .mission.flash .mname {
    color: var(--accent-contrast);
  }
  .mission .mpop {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .mission .mbonus {
    margin-left: auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .mission.flash .mbonus,
  .mission.flash .mpop {
    color: var(--accent-contrast);
  }

  .mission-mark {
    animation: markPulse 1s ease-in-out infinite;
  }
  @keyframes markPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  .mission-ping {
    transform-box: fill-box;
    transform-origin: center;
    animation: ping 1.4s ease-out infinite;
  }
  @keyframes ping {
    0% { transform: scale(0.4); opacity: 0.7; }
    100% { transform: scale(1.6); opacity: 0; }
  }

  .stage {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .stage.wide {
    flex-direction: row;
  }
  .board {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;

    background: var(--board-frame);
    overflow: hidden;
  }

  .log {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    flex: none;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-top: 1px solid var(--border);
    overflow: hidden;
  }
  .stage.wide .log {
    width: 320px;
    border-top: 0;
    border-left: 1px solid var(--border);
  }
  .log-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px 6px;
  }
  .log-head h2 {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .log-count {
    font-size: 0.82rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .log-count .of {
    color: var(--text-muted);
    font-weight: 500;
  }
  .log-sub {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 0 12px 8px;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--divider);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .log-sub strong {
    font-size: 0.92rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .log-list {
    list-style: none;
    margin: 0;
    padding: 4px 6px 6px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    scrollbar-width: thin;
  }
  .log-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 5px 6px;
    border-radius: 7px;
    font-size: 0.8rem;
  }
  .log-list li + li {
    border-top: 1px solid var(--divider);
  }
  .log-list li:hover {
    background: var(--surface-hover);
  }
  .log-list .dot {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    flex: none;
  }
  .log-list .name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  .log-list .rank {
    flex: none;
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 999px;
    padding: 1px 6px;
    font-variant-numeric: tabular-nums;
  }
  .log-list .pop {
    flex: none;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    font-size: 0.74rem;
  }
  .log-list .empty {
    color: var(--text-muted);
    font-style: italic;
    border: 0;
  }
  .log-list .empty:hover {
    background: transparent;
  }
  svg {
    display: block;
    cursor: none;
    touch-action: none;
  }

  .hit {
    position: absolute;
    inset: 0;
    background: transparent;
    border: 0;
    cursor: pointer;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
  }

  .ready-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: clamp(0.75rem, 4vw, 1.5rem);
    background: color-mix(in srgb, var(--board-bg) 88%, transparent);
    text-align: center;
    pointer-events: none;
  }
  .ready-title {
    font-size: clamp(1.6rem, 6vw, 2.6rem);
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .ready-hint {
    max-width: 100%;
    font-size: clamp(0.72rem, 2.6vw, 0.95rem);
    color: var(--text-muted);
    line-height: 1.35;
  }

  .result-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: clamp(0.75rem, 4vw, 1.5rem);
    background: color-mix(in srgb, var(--board-bg) 90%, transparent);
    text-align: center;
    overflow-y: auto;
    pointer-events: none;
  }
  .result-title {
    font-size: clamp(1.5rem, 6vw, 2.6rem);
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }
  .result-title.win {
    color: var(--positive);
  }
  .result-title.lose {
    color: var(--accent);
  }
  .result-sub {
    margin-top: 0.1rem;
    font-size: clamp(0.95rem, 3.4vw, 1.2rem);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .result-line {
    max-width: 100%;
    font-size: clamp(0.78rem, 2.8vw, 1rem);
    color: var(--text-secondary);
    line-height: 1.35;
  }
  .result-cta {
    margin-top: 0.5rem;
    font-size: clamp(0.74rem, 2.6vw, 0.95rem);
    color: var(--text-muted);
  }

  .pause-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    color: var(--text-secondary);
    cursor: pointer;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
  }
  .pause-btn:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .pause-btn svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  .pause-overlay {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: clamp(0.75rem, 4vw, 1.5rem);
    border: 0;
    background: color-mix(in srgb, var(--board-bg) 82%, transparent);
    text-align: center;
    cursor: pointer;
    font: inherit;
  }
  .pause-title {
    font-size: clamp(1.6rem, 6vw, 2.6rem);
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--text);
  }
  .pause-hint {
    font-size: clamp(0.74rem, 2.6vw, 0.95rem);
    color: var(--text-muted);
  }

  .start {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: clamp(0.75rem, 3vw, 1.5rem);
    background: color-mix(in srgb, var(--board-bg) 88%, transparent);
    text-align: center;
    overflow-y: auto;
  }
  .start-title {
    margin: 0;
    font-size: clamp(1.4rem, 4vw, 2.2rem);
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text);
  }
  .start-sub {
    margin: 0 0 0.6rem;
    font-size: 0.95rem;
    color: var(--text-secondary);
  }
  .modes {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.9rem;
    width: 100%;
    max-width: 560px;
  }

  .mode-card {
    flex: 1 1 220px;
    max-width: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 1.1rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 0.1s;
  }
  .mode-card:hover {
    border-color: var(--border-strong);
    background: var(--surface-hover);
    transform: translateY(-2px);
  }
  .mode-card:active {
    transform: translateY(0);
  }
  .mode-card.accent {
    border-color: var(--accent);
  }
  .mode-card.accent:hover {
    background: var(--accent-soft);
  }
  .mode-name {
    font-size: 1.05rem;
    font-weight: 700;
  }
  .mode-card.accent .mode-name {
    color: var(--accent);
  }
  .mode-desc {
    font-size: 0.8rem;
    color: var(--text-secondary);
    line-height: 1.35;
  }
  .start-hint {
    margin: 0.4rem 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .combo-pop {
    fill: var(--accent);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    stroke: var(--board-bg);
    stroke-width: 3;
    paint-order: stroke fill;
    pointer-events: none;
  }

  .ticker {
    margin: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 10px;
    text-align: center;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .ticker strong {
    color: var(--accent);
    font-weight: 700;
  }

  @media (max-width: 560px) {
    .hud {
      justify-content: flex-start;
    }
    .title h1 {
      font-size: 1rem;
    }
    .stats {
      width: 100%;
      gap: 0.4rem 1rem;
    }
    .value {
      font-size: 1rem;
    }
    .start {
      gap: 0.4rem;
      justify-content: flex-start;
    }
    .start-sub {
      margin-bottom: 0.3rem;
    }
    .modes {
      flex-direction: column;
      gap: 0.5rem;
      align-items: stretch;
    }
    .mode-card {
      flex: 0 0 auto;
      max-width: none;
      width: 100%;
      padding: 0.7rem 0.85rem;
      gap: 0.2rem;
    }
    .mode-name {
      font-size: 0.98rem;
    }
    .mode-desc {
      font-size: 0.75rem;
    }
    .start-hint {
      font-size: 0.7rem;
    }
  }
</style>
