import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // path aset relatif agar dist bisa disajikan dari folder/subpath mana pun
  base: './',
  // viteSingleFile meng-inline JS, CSS, dan aset (logo) ke dalam satu index.html
  // sehingga file hasil build bisa langsung dibuka / di-drag ke Chrome (file://).
  plugins: [react(), viteSingleFile()],
  build: {
    assetsInlineLimit: 100000000, // inline semua aset (termasuk logo PNG) sebagai data URI
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100000,
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
