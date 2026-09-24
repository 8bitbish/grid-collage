# onnxruntime-web, to run ViTMatte

From `onnxruntime-web` 1.30.0 on npm, unchanged: `dist/ort.webgpu.min.mjs`
and the one wasm build it loads, `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`.
MIT (`LICENSE.txt`). Used only with the WebGPU execution provider, one
thread, since Pages cannot send the headers SharedArrayBuffer needs.
