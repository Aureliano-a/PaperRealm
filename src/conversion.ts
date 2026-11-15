import * as OpenCC from "opencc-js";
const converters = new Map<string, (s: string) => string>();
export function convert(text: string, mode: string) {
  if (mode === "original") return text;
  let fn = converters.get(mode);
  if (!fn) {
    const simple = OpenCC.Converter({ from: "t", to: "cn" });
    const target =
      mode === "cn"
        ? (s: string) => s
        : OpenCC.Converter({ from: "cn", to: mode as "t" | "tw" | "hk" });
    fn = (s) => target(simple(s));
    converters.set(mode, fn);
  }
  return fn(text);
}
