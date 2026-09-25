import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/preload/index.ts',
          'ssh-prompt': 'src/preload/ssh-prompt.ts'
        }
      }
    }
  },
  renderer: { plugins: [react()] }
})
