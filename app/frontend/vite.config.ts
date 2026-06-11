import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Source maps are generated and uploaded to Sentry only when SENTRY_AUTH_TOKEN
// is present (i.e. in the Railway Docker build). The maps are deleted from
// dist/ after upload so readable source is never served to browsers. Builds
// without the token behave exactly as before.
const uploadSourceMaps = !!process.env.SENTRY_AUTH_TOKEN

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    uploadSourceMaps &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: 'javascript-react',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
        // A failed upload should cost us readable stack traces, not the deploy.
        errorHandler(err) {
          console.warn('Sentry source-map upload failed (build continues):', err.message)
        },
      }),
  ],
  build: {
    sourcemap: uploadSourceMaps,
  },
  server: {
    host: '0.0.0.0', // Allow Docker access
    port: 5173,
    watch: {
      usePolling: true, // Enable hot reload in Docker
    },
  },
})
