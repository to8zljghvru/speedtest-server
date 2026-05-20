# Speed Test Site

A self-hosted speed test website and Node server in one small app.

## How to Host

- Build command: `npm install`
- Start command: `npm start`

The server uses `PORT` environment variable.

## Local development

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Endpoints

- `GET /health` returns a simple health check.
- `GET /api/ping` measures latency.
- `GET /api/download?size=16777216` streams bytes for download testing.
- `POST /api/upload` accepts raw bytes for upload testing.
