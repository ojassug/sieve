# ADR-0015: Frontend stack

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [roadmap.md](../roadmap.md) M9

## Context
The UI has to make the algorithms visible: impact graphs with 10k+ nodes, why-paths, live shard progress, flake heatmaps and statistical traces. The goal is a polished interactive product, scaling SeamCraft's visual feedback and TokenDamper's diff dashboard up to a web product.

## Decision
- A React + Vite single-page app, served by the API.
- TanStack Router and TanStack Query.
- Radix primitives for accessible components.
- Sigma.js v3 with graphology (WebGL) for large impact graphs.
- elkjs layered layout for small why-path views.
- uPlot for time series, and custom SVG for heatmaps.

## Alternatives considered
- **Svelte/SvelteKit or Solid:** rejected. Smaller ecosystems for graph and data visualisation.
- **Cytoscape.js:** rejected for large graphs. Its WebGL renderer is still a preview; its own benchmark shows about 3,200 nodes and 68k edges at 10 FPS with WebGL versus 3 FPS on canvas ([blog](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)).
- **D3 force layouts in SVG:** rejected. Too slow at 10k nodes.

## Consequences
- The Sigma.js project site already shows v4 while npm's stable release is v3. Re-check the status before M9.
- Performance target: 10k nodes at ≥30 FPS on a mid-range laptop. Accessibility audit score ≥90.
