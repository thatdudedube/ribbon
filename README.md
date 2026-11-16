# Ribbon

Gift planning for Emeka, Dube and Chioma: wish lists, private suggestions, budgets, settle-up and reminders.

- App: https://thatdudedube.github.io/ribbon/
- `web/` is the app (deployed to GitHub Pages).
- `functions/` runs on Firebase: sign-up check, AI gift ideas, reminders.
- `firestore.rules` / `storage.rules`: only the three members can read or change anything.
- Every push to `main` runs `.github/workflows/deploy.yml`: tests, then deploys the backend and the site.

Secrets (Settings → Secrets and variables → Actions): `FIREBASE_SERVICE_ACCOUNT`, `ANTHROPIC_API_KEY`, `ALLOWED_EMAILS` (`email:Name,email:Name,email:Name`).
