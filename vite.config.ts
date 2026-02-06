import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api/public': {
        target: 'https://apis.data.go.kr/B553077/api/open/sdsc2',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/public/, ''),
        secure: false
      },
      '/api/sgis': {
        target: 'https://sgisapi.mods.go.kr/OpenAPI3',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sgis/, ''),
        secure: false
      },
      '/api/seoul': {
        target: 'http://openapi.seoul.go.kr:8088',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/seoul/, ''),
        secure: false
      },
      '/api/sbiz': {
        target: 'https://bigdata.sbiz.or.kr/sbiz/api/bizonSttus',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sbiz/, ''),
        secure: false,
        headers: {
          'Referer': 'https://sg.sbiz.or.kr/'
        }
      }
    }
  }
})