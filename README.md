# Calculator

Monorepo for the AWS deployment activity.

- `frontend/` — React + Vite calculator UI
- `backend/` — Lambda handler exposing `calculate(expression)`

## Local dev

```
npm install --workspaces
npm --workspace frontend run dev
```

## Deploy

Frontend → AWS Amplify (auto-deploys on push to `main`).
Backend → AWS Lambda (`calculate`) behind API Gateway REST API.
