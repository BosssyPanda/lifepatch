Decoders for the intro's compressed 3D files, served from this site rather than a CDN because the
CSP's connect-src (next.config.ts) only lets the page fetch from its own origin. Copied unchanged
from three@0.185.1:

- draco/ — node_modules/three/examples/jsm/libs/draco/gltf/ (Google Draco, Apache-2.0); the WASM
  build only, which every desktop browser runs.
- basis/ — node_modules/three/examples/jsm/libs/basis/ (Binomial Basis Universal, Apache-2.0).

Update them together with three.
