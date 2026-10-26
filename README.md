# Laural's Haven Admin Console

Password protected dashboard for kitchen operations.

## GitHub Pages deployment

This repo is a static site and should be deployed from the `main` branch with GitHub Pages enabled. A Pages workflow is included in `.github/workflows/deploy-pages.yml` so the site is published automatically on each push.

## Shared backend configuration

The storefront and admin console should point to the same live backend API by setting `window.LH_API_BASE` before the app script loads, for example:

```html
<script>
  window.LH_API_BASE = 'https://your-shared-api-domain.example';
</script>
```

If `window.LH_API_BASE` is left blank, the apps fall back to the current origin.

