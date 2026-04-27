Subject: CORS works in curl but fails in browser — quick fix

Hi Professor,

curl skips the preflight that browsers do for non-simple requests (e.g., `Content-Type: application/json`), which is why it can pass while the browser fails. The fix is in two places, both required:

1. **API Gateway**: add an OPTIONS method on `/CalculatorManager` with a MOCK integration that returns `Access-Control-Allow-Origin/Methods/Headers`. Then redeploy the stage — easy to forget.
2. **Lambda**: return those same CORS headers on every response, including error paths.

Full breakdown with copy-pasteable AWS CLI commands and an 8-item gotcha table is in `CORS-NOTES.md` in the repo.

— Jacob
