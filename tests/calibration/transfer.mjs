/* How an edit treats detail of each size in a photo: its transfer function,
 * read off the photo and the edited copy themselves rather than off gratings.
 *
 * A grating says what a filter does to one stripe. A photo has detail at
 * every size and direction at once, and Google's Sharpen turned out not to
 * treat the two alike — on a fox it lifted 12px detail ×2.03 where the
 * chart's gratings said the lift was over by then — so this reads it from
 * the photo. Both images are cut into 256px tiles overlapping by half, each
 * windowed and transformed, and at each period the edited copy's spectrum
 * is set against the original's: the real part of their cross-spectrum over
 * the original's power, summed over a ring of frequencies within 12% of the
 * period, in every direction. That is the gain a linear filter would need to
 * turn one into the other, and detail the edit invents rather than lifts —
 * noise, aliasing, JPEG — does not count towards it.
 *
 * Plain JavaScript on brightness arrays, so the calibration scripts and the
 * test suite read it the same way.
 */
export const PERIODS = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32, 48];
const N = 256;

// An in-place radix-2 FFT of one row or column, N points.
const BITS = Math.log2(N);
const REVERSED = Uint16Array.from({ length: N }, (_, i) => {
  let r = 0;
  for (let b = 0; b < BITS; b += 1) r |= ((i >> b) & 1) << (BITS - 1 - b);
  return r;
});
const COS = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / N));
const SIN = Float64Array.from({ length: N / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / N));
function fft(re, im, offset, stride) {
  for (let i = 0; i < N; i += 1) {
    const j = REVERSED[i];
    if (j > i) {
      const a = offset + i * stride, b = offset + j * stride;
      [re[a], re[b]] = [re[b], re[a]];
      [im[a], im[b]] = [im[b], im[a]];
    }
  }
  for (let size = 2; size <= N; size *= 2) {
    const half = size / 2, step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k += 1) {
        const a = offset + (start + k) * stride, b = a + half * stride;
        const wr = COS[k * step], wi = SIN[k * step];
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
function spectrum(img, width, x0, y0) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  let mean = 0;
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) mean += img[(y0 + y) * width + x0 + x];
  mean /= N * N;
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) re[y * N + x] = (img[(y0 + y) * width + x0 + x] - mean) * HANN[x] * HANN[y];
  for (let y = 0; y < N; y += 1) fft(re, im, y * N, 1);
  for (let x = 0; x < N; x += 1) fft(re, im, x, N);
  return { re, im };
}

// Which ring each frequency falls in for each period, worked out once.
const freq = (k) => (k < N / 2 ? k : k - N) / N;
function rings(periods) {
  return periods.map((p) => {
    const list = [];
    for (let v = 0; v < N; v += 1) {
      for (let u = 0; u < N; u += 1) {
        const f = Math.hypot(freq(u), freq(v));
        if (f > 1 / p / 1.12 && f < (1 / p) * 1.12) list.push(v * N + u);
      }
    }
    return list;
  });
}

// `original` and `edited` are brightness, one number a pixel, width x height.
// Returns the gain at each period, in that image's own pixels.
export function transfer(original, edited, width, height, periods = PERIODS) {
  const where = rings(periods);
  const cross = new Float64Array(periods.length), power = new Float64Array(periods.length);
  for (let y0 = 0; y0 + N <= height; y0 += N / 2) {
    for (let x0 = 0; x0 + N <= width; x0 += N / 2) {
      const a = spectrum(original, width, x0, y0), b = spectrum(edited, width, x0, y0);
      where.forEach((list, i) => {
        for (const k of list) {
          cross[i] += b.re[k] * a.re[k] + b.im[k] * a.im[k];
          power[i] += a.re[k] ** 2 + a.im[k] ** 2;
        }
      });
    }
  }
  return periods.map((_, i) => cross[i] / power[i]);
}
