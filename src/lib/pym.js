import { onMount } from 'svelte';
import pym from 'pym.js';

let pymChild = null;

export function initPym() {
  onMount(() => {
    if (typeof window === 'undefined') return;
    if (window.self === window.top) return;
    pymChild = new pym.Child({ polling: 500 });
    setTimeout(() => pymChild && pymChild.sendHeight(), 50);
  });
}

export function sendHeight() {
  if (pymChild) setTimeout(() => pymChild && pymChild.sendHeight(), 50);
}
