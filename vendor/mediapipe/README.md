# MediaPipe, for finding a photo's subject

Loaded by `app.js` the first time an effect needs a subject, and kept by the
service worker from then on. Nothing here is fetched otherwise.

| file | from |
| --- | --- |
| `vision_bundle.mjs` | `@mediapipe/tasks-vision` 0.10.35 on npm, unchanged |
| `vision_wasm_internal.js`, `vision_wasm_internal.wasm` | the same package's `wasm/`, unchanged — only the SIMD build, since `app.js` names these files itself rather than letting `FilesetResolver` choose |
| `magic_touch.tflite` | `storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/`, sha256 `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25` |
| `efficientdet_lite0.tflite` | `storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/`, sha256 `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb` |

All Apache-2.0: the library per its package, MagicTouch per its model card.
EfficientDet-Lite0 is Google's own build for MediaPipe, from the TensorFlow
Model Garden; no separate model card was found for it.

Version 1.0 of the package was measured and not taken. Its `InteractiveSegmenter`
expects a different, 30MB model, and loads this one only through a legacy
class that looks to be on its way out.
