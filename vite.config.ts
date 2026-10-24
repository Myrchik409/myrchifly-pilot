import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  publicDir: 'assets',
  build: { outDir: 'web-dist', emptyOutDir: true }
})
