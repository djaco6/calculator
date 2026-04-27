# CORS in the Calculator deploy: why curl passed but the browser didn't

## The symptom your professor hit

> "CORS works in `curl` but fails in the browser."

Every time. Universally. The reason is one sentence:

**`curl` does not send preflight requests. Browsers do.**

Once you internalize that, the bug practically debugs itself — but the fix has to happen in *two* places (Lambda *and* API Gateway), and the AWS Console "Enable CORS" wizard only does one of them reliably. That mismatch is what creates the curl-passes/browser-fails state.

---

## What a browser actually does for `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })`

The browser classifies the request as **non-simple** (because `Content-Type: application/json` is not in the simple-request allowlist of `text/plain | application/x-www-form-urlencoded | multipart/form-data`). Non-simple requests trigger the **CORS preflight protocol**:

1. Browser sends `OPTIONS /CalculatorManager` with these headers:
   ```
   Origin: https://main.d3usslckkxh35k.amplifyapp.com
   Access-Control-Request-Method: POST
   Access-Control-Request-Headers: content-type
   ```
2. Browser waits for a `2xx` response that includes:
   ```
   Access-Control-Allow-Origin: <your origin or *>
   Access-Control-Allow-Methods: POST
   Access-Control-Allow-Headers: content-type
   ```
3. **Only then** does the browser send the actual `POST`.
4. The `POST` response *also* needs `Access-Control-Allow-Origin`, or the browser refuses to expose the response body to JavaScript.

`curl -X POST ...` skips all of step 1–3 and just fires the POST. If your POST response has the right header, curl is happy. **The browser will fail at step 1 long before it ever sends the POST.** That's the entire mystery.

You'll see it in DevTools as one of:
- `OPTIONS /CalculatorManager 403 Forbidden` (API Gateway saying "I don't have an OPTIONS method")
- `Access to fetch at '...' from origin '...' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present...`
- `OPTIONS 200` but the actual POST never fires, with: `Method POST is not allowed by Access-Control-Allow-Methods`

---

## What I configured, and why each layer matters

There are **two layers** for a Lambda-backed REST API. Each layer can break preflight independently. You need both right.

### Layer 1 — API Gateway: an explicit `OPTIONS` method on `/CalculatorManager`

API Gateway does not transparently handle preflight for you. By default, an undefined HTTP method returns `403 Forbidden / Missing Authentication Token` — which is precisely the error that confuses everyone, because it doesn't *say* "CORS." The preflight just dies and the browser reports a CORS failure.

I added the `OPTIONS` method with a **MOCK integration** (no Lambda invocation, just static headers — fast and free):

```bash
# 1. Declare the OPTIONS method exists
aws apigateway put-method \
  --rest-api-id "$API_ID" --resource-id "$RES_ID" \
  --http-method OPTIONS --authorization-type NONE

# 2. MOCK integration: API Gateway answers OPTIONS itself, no backend call
aws apigateway put-integration \
  --rest-api-id "$API_ID" --resource-id "$RES_ID" \
  --http-method OPTIONS --type MOCK \
  --request-templates '{"application/json":"{\"statusCode\":200}"}'

# 3. DECLARE which response headers exist (must come before integration-response)
aws apigateway put-method-response \
  --rest-api-id "$API_ID" --resource-id "$RES_ID" \
  --http-method OPTIONS --status-code 200 \
  --response-parameters '{
    "method.response.header.Access-Control-Allow-Headers": true,
    "method.response.header.Access-Control-Allow-Methods": true,
    "method.response.header.Access-Control-Allow-Origin":  true
  }'

# 4. SET the actual values. Note the doubled single quotes — required.
aws apigateway put-integration-response \
  --rest-api-id "$API_ID" --resource-id "$RES_ID" \
  --http-method OPTIONS --status-code 200 \
  --response-parameters '{
    "method.response.header.Access-Control-Allow-Headers": "'"'"'Content-Type'"'"'",
    "method.response.header.Access-Control-Allow-Methods": "'"'"'POST,OPTIONS'"'"'",
    "method.response.header.Access-Control-Allow-Origin":  "'"'"'*'"'"'"
  }'
```

Three things in that block trip people up:

1. **`put-method-response` *before* `put-integration-response`.** The first declares "this header is part of the contract." The second supplies the value. If you skip the first, the second silently does nothing and the header never reaches the browser.
2. **The `'"'"'...'"'"'` shell quoting.** API Gateway expects the header *value* to be a JSON string whose contents are surrounded by literal single quotes — i.e., the value as-stored is `'Content-Type'` (with the quotes). If you write `"Content-Type"` you'll get a header value of `Content-Type` (no quotes around it inside API Gateway's value), which sometimes works and sometimes doesn't depending on which version of the SDK is parsing.
3. **You must redeploy the stage after changes.** `aws apigateway create-deployment --stage-name test`. The Console "Actions → Enable CORS" button forgets this almost every time. If your changes "didn't take effect," 90% of the time you forgot to redeploy.

### Layer 2 — Lambda: CORS headers on *every* response (and explicit OPTIONS handling)

Because my POST uses **Lambda proxy integration (`AWS_PROXY`)**, API Gateway passes the Lambda's headers straight through to the browser unchanged. That means Lambda is responsible for putting the `Access-Control-Allow-Origin` header on the actual POST response — API Gateway will *not* add it for you in proxy mode.

The handler in `backend/index.mjs`:

```js
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

export const handler = async (event) => {
  // Belt-and-suspenders: handle OPTIONS in Lambda too,
  // in case the API Gateway OPTIONS method ever gets pointed at Lambda.
  if (event?.httpMethod === 'OPTIONS' || event?.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  // ...calculate logic...
  try {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ result }) };
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
```

Three rules I followed:

1. **CORS headers on success *and* error responses.** A common bug: `200` has CORS headers, `400/500` doesn't. Browser sees the error response, doesn't find `Access-Control-Allow-Origin`, refuses to expose the body to JavaScript. The user sees "Network error" with no detail. Always include CORS on every code path.
2. **OPTIONS handler in Lambda even though API Gateway also handles it.** This is the belt-and-suspenders. If someone later changes the OPTIONS integration in API Gateway from MOCK to Lambda proxy (a very common refactor), the function still works without modification.
3. **Keys must be exactly the headers the browser asked for.** If the browser sends `Access-Control-Request-Headers: content-type, authorization`, your `Access-Control-Allow-Headers` must include both. Mismatched casing is fine (HTTP headers are case-insensitive), but missing headers will fail preflight.

---

## The full preflight → POST flow, traced end-to-end

Here is what happens when the user opens the calculator and presses `=`:

```
1. Browser:                  fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"expression":"7*8"}' })

2. Browser → API Gateway:    OPTIONS /test/CalculatorManager
                             Origin: https://main.d3usslckkxh35k.amplifyapp.com
                             Access-Control-Request-Method: POST
                             Access-Control-Request-Headers: content-type

3. API Gateway:              MOCK integration responds 200 with:
                             Access-Control-Allow-Origin:  *
                             Access-Control-Allow-Methods: POST,OPTIONS
                             Access-Control-Allow-Headers: Content-Type

4. Browser:                  Preflight cached for 0 s (no Access-Control-Max-Age set), proceeds.

5. Browser → API Gateway:    POST /test/CalculatorManager
                             Content-Type: application/json
                             { "expression": "7*8" }

6. API Gateway → Lambda:     Invokes `calculate` function via AWS_PROXY integration.

7. Lambda:                   calculate("7*8") → "56"
                             Returns: { statusCode: 200, headers: { ...cors }, body: '{"result":"56"}' }

8. API Gateway → Browser:    200 OK
                             Access-Control-Allow-Origin: *
                             Body: {"result":"56"}

9. Browser:                  Origin check passes, body exposed to JavaScript, calculator displays 56.
```

If **any** step from 2 → 4 fails, the browser never sends step 5. That's the curl-vs-browser asymmetry.

---

## The 8 mistakes that cause "curl works, browser doesn't"

In rough order of frequency:

| # | Mistake | Symptom in DevTools | Fix |
|---|---------|---------------------|-----|
| 1 | No OPTIONS method on the API Gateway resource | `OPTIONS 403 Missing Authentication Token` | Add OPTIONS with MOCK integration (Layer 1 above) |
| 2 | Made changes in Console but didn't redeploy the stage | Network shows old behavior; Console swears it's fixed | `aws apigateway create-deployment --rest-api-id ... --stage-name test` (or "Deploy API" button) |
| 3 | CORS headers on Lambda 200 response but missing on 400/500 | Works for valid input, fails for invalid | Include `headers: cors` on every return path |
| 4 | `Access-Control-Allow-Origin: <wrong origin>` (e.g., trailing slash, http vs https) | `does not match the supplied origin` | Either use `*` (no credentials) or echo the request's `Origin` exactly |
| 5 | `Access-Control-Allow-Headers` missing a header the client sends | `field <name> is not allowed by Access-Control-Allow-Headers` | Add it. For JSON requests: at minimum `Content-Type` |
| 6 | Forgot `put-method-response` before `put-integration-response` | OPTIONS 200 but headers missing from response | Always declare the method response first |
| 7 | `credentials: 'include'` on the client + `Allow-Origin: *` on server | `Cannot use wildcard with credentials` | Either drop `credentials: 'include'` or echo the specific origin |
| 8 | Lambda proxy integration but expecting API Gateway to add CORS | Headers configured in API Gateway "Method Response" never appear | In `AWS_PROXY` mode API Gateway passes Lambda's headers through verbatim — set them in Lambda |

---

## How to debug a failing CORS setup in 60 seconds

```bash
# 1. Did the OPTIONS preflight succeed?
curl -i -X OPTIONS "$INVOKE_URL" \
  -H "Origin: https://main.d3usslckkxh35k.amplifyapp.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"

# Expect: HTTP/2 200 (or 204) with all three Access-Control-Allow-* headers.
# If you get 403: Layer 1 is broken — OPTIONS method missing.
# If you get 200 with no headers: put-method-response missing or value-quoting wrong.

# 2. Does the POST response include the origin header?
curl -i -X POST "$INVOKE_URL" \
  -H "Content-Type: application/json" \
  -H "Origin: https://main.d3usslckkxh35k.amplifyapp.com" \
  -d '{"expression":"2+2"}'

# Expect: Access-Control-Allow-Origin: * in the response headers.
# Missing: Layer 2 is broken — Lambda not setting cors on success path.

# 3. Does the POST 400 path also include the origin header?
curl -i -X POST "$INVOKE_URL" \
  -H "Content-Type: application/json" \
  -d '{"expression":"haha"}'

# Expect: 400 with Access-Control-Allow-Origin: *.
# Missing: Layer 2 error path missing cors headers.
```

If all three pass with `curl`, the browser will too.

---

## TL;DR

CORS for a Lambda+API Gateway REST endpoint is **two configurations that must agree**:

1. **API Gateway** must answer `OPTIONS` with a 200 and the `Access-Control-Allow-*` trio. Easiest way: MOCK integration on OPTIONS, manually configured `put-method-response` + `put-integration-response`. **Then redeploy the stage.**
2. **Lambda** must include `Access-Control-Allow-Origin` (and friends) on **every** response — success, validation error, and exception paths.

`curl` skips step 1 entirely, so it can't tell you when step 1 is broken. The browser does step 1 first, every time, which is why it sees what curl can't.
