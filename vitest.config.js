import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx', 'api/**/*.test.js'],
    environmentMatchGlobs: [
      ['src/**/*.test.jsx', 'jsdom'],
    ],
  },
})
