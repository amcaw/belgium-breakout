<script>
  import BelgiumBreakout from '$lib/BelgiumBreakout.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Belgium Breakout — un jeu d3-geo</title>
  <meta name="description" content="Casse-briques basé sur les communes de Belgique, en d3-geo." />
</svelte:head>

<main>
  <BelgiumBreakout geojson={data.geojson} />
</main>

<style>
  main {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
  }

  :global(body.standalone) main {
    height: 100dvh;
  }
</style>
