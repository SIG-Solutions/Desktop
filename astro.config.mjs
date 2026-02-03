import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://leadlabs.co.za',
  output: 'static',
  build: {
    assets: 'assets'
  },
  vite: {
    build: {
      cssMinify: true
    }
  }
});
