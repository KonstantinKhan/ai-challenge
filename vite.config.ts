import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/oauth': {
        target: 'https://ngw.devices.sberbank.ru:9443',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/oauth/, '/api/v2/oauth'),
      },
      '/api/chat': {
        target: 'https://gigachat.devices.sberbank.ru',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/chat/, '/api/v1/chat/completions'),
      },
      '/api/huggingface': {
        target: 'https://router.huggingface.co',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/huggingface/, '/v1/chat/completions'),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Передаем все заголовки от клиента, включая Authorization
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization);
            }
          });
        },
      },
      '/api/openrouter': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/openrouter/, '/api/v1/chat/completions'),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Передаем все заголовки от клиента, включая Authorization
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization);
            }
            if (req.headers['http-referer']) {
              proxyReq.setHeader('HTTP-Referer', req.headers['http-referer']);
            }
            if (req.headers['x-title']) {
              proxyReq.setHeader('X-Title', req.headers['x-title']);
            }
          });
        },
      },
      '/api/summaries': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/api/agent/tasks': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/api/rag': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/rag/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.method === 'GET') {
              proxyReq.setHeader('Accept', 'text/event-stream');
              proxyReq.setHeader('Cache-Control', 'no-cache');
              proxyReq.setHeader('Connection', 'keep-alive');
            }
            proxyReq.removeHeader('origin');
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            proxyRes.headers['access-control-allow-origin'] = '*';
            proxyRes.headers['access-control-allow-methods'] = 'GET, POST, DELETE, OPTIONS';
            proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Accept, Authorization, Mcp-Session-Id';
          });
        },
      },
      '/api/git': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/git/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.method === 'GET') {
              proxyReq.setHeader('Accept', 'text/event-stream');
              proxyReq.setHeader('Cache-Control', 'no-cache');
              proxyReq.setHeader('Connection', 'keep-alive');
            }
            proxyReq.removeHeader('origin');
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            proxyRes.headers['access-control-allow-origin'] = '*';
            proxyRes.headers['access-control-allow-methods'] = 'GET, POST, DELETE, OPTIONS';
            proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Accept, Authorization, Mcp-Session-Id';
          });
        },
      },
    },
  },
})
