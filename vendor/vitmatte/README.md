# ViTMatte-S, for the edge of a popped-out subject

Loaded by `app.js` the first time a subject is cut on a browser with WebGPU,
and kept by the service worker from then on. Without WebGPU it is never
fetched and the cut is the guided filter's.

`vitmatte-small.onnx` is `onnx/model.onnx` from Xenova's export of
hustvl/vitmatte-small-composition-1k on Hugging Face
(sha256 `bf28d2e0be2c073286e88d60ad649d7123da2749a2d99133fd1098d5887e0225`,
103,885,865 bytes), with every weight over sixteen values stored as float16
and a Cast back to float32 in front of it, which onnxruntime folds away when
the session is made. So it computes in full precision from a file half the
size — the full-precision file is over GitHub's 100MB limit, and the export's
own float16 file would not load on onnxruntime's WebGPU backend.

## Licence: non-commercial

The code is MIT (`LICENSE.txt`, from hustvl/ViTMatte) and the weights are
labelled Apache-2.0, but they were trained on Adobe's Composition-1k matting
data, whose licence allows non-commercial research use only and, as the
GCA-Matting project reads it, covers models trained on it. This app is a
personal, non-commercial project and carries it on that basis. Anyone taking
the app somewhere commercial should take this out first; `app.js` falls back
to the guided-filter cut when `loadMatte()` finds nothing.
