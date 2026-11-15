import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('/pdf-resources/pdf.worker.mjs',location.href).href;
export default pdfjs;
