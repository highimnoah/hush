/**
 * Latest live spectrum frame from the Rust audio pipeline.
 *
 * This is intentionally kept outside React state: the engine emits frames at
 * ~25 Hz while playing, and updating a Zustand store that often would churn
 * the active row component unnecessarily. The visualizer reads this value in a
 * requestAnimationFrame loop and writes transform values directly to the DOM.
 */

export const SPECTRUM_BANDS = 5;

interface SpectrumFrame {
  bands: number[];
  receivedAt: number;
}

let frame: SpectrumFrame = {
  bands: new Array(SPECTRUM_BANDS).fill(0),
  receivedAt: 0,
};

export function setSpectrumBands(bands: number[]) {
  frame = {
    bands: bands.slice(0, SPECTRUM_BANDS),
    receivedAt: performance.now(),
  };
}

export function getSpectrumBands(): SpectrumFrame {
  return frame;
}
