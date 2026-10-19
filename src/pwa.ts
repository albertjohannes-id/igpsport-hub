// Register only compiled builds; a worker must never cache Vite's development app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      /* Online operation remains available if installation is blocked. */
    });
  });
}
