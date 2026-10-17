import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: false,\n    rollupOptions: {\n      input: {\n        main: 'index.html',\n        new: 'new/index.html',\n      },\n    },
  },
});
