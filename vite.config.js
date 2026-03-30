import react from '@vitejs/plugin-react';

export default {
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ['leaflet', 'react-leaflet'],
          recharts: ['recharts'],
          turf: ['@turf/turf', '@turf/area'],
        },
      },
    },
  },
};
