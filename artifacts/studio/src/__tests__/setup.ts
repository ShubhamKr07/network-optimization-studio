import "@testing-library/jest-dom";

// Radix UI components (Slider, Select, etc.) use ResizeObserver — jsdom doesn't implement it.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
