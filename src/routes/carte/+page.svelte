<script>
  import BelgiumExplorer from '$lib/BelgiumExplorer.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Carte des communes — Belgium Breakout</title>
  <meta name="description" content="Explorer la grille des communes de Belgique." />
</svelte:head>

<BelgiumExplorer geojson={data.geojson} />
