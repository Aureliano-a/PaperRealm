import { paginate } from "./engine";
self.onmessage = (e) => {
  const { id, text, layout, widths } = e.data;
  try {
    postMessage({ id, pages: paginate(text, layout, widths) });
  } catch (error) {
    postMessage({ id, error: String(error) });
  }
};
