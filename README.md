# Synode TRELLIS.2 iframe

This is a static Nuxt 2 application designed to be embedded without page scrolling.

```html
<iframe
  src="https://YOUR-DEPLOYED-DOMAIN/embed"
  title="Synode Image to 3D"
  style="width: 100%; height: 100vh; border: 0"
  allow="fullscreen"
></iframe>
```

Run `npm run generate` to produce the static `dist/` directory.

## Google Cloud Run

The included multi-stage `Dockerfile` builds the Nuxt static site and serves it
with Nginx on port `8080`, as required by Cloud Run. `cloudbuild.yaml` builds
the image, pushes it to Artifact Registry, then deploys it to Cloud Run.

In the Cloud Build trigger, choose **Cloud Build configuration file** and use
`cloudbuild.yaml`. Before the first deploy, create an Artifact Registry Docker
repository named `synode` in `asia-southeast1`, or change `_REPOSITORY` and
`_AR_LOCATION` in the trigger substitutions.

The Cloud Build service account needs Artifact Registry Writer and Cloud Run
Admin roles. Its service account must also have Service Account User on the
Cloud Run runtime service account.
