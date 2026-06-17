import belgium from '$lib/data/belgium.json';

export const prerender = true;

function rewind(fc) {
  return {
    ...fc,
    features: fc.features.map((f) => {
      if (f.geometry?.type !== 'Polygon') return f;
      return {
        ...f,
        geometry: {
          ...f.geometry,
          coordinates: f.geometry.coordinates.map((ring) => [...ring].reverse())
        }
      };
    })
  };
}

export function load() {
  return { geojson: rewind(belgium) };
}
