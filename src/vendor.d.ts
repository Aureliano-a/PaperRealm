declare module "opencc-js" {
  export function Converter(options: {
    from: string;
    to: string;
  }): (text: string) => string;
}
declare module '*?url' { const url: string; export default url; }
