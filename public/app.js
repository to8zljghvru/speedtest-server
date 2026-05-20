const startButton = document.querySelector("#startButton");
const statusText = document.querySelector("#statusText");
const activeValue = document.querySelector("#activeValue");
const activeUnit = document.querySelector("#activeUnit");
const gaugeFill = document.querySelector("#gaugeFill");
const needle = document.querySelector("#needle");
const pingValue = document.querySelector("#pingValue");
const jitterValue = document.querySelector("#jitterValue");
const downloadValue = document.querySelector("#downloadValue");
const uploadValue = document.querySelector("#uploadValue");
const serverLabel = document.querySelector("#serverLabel");
const lastRun = document.querySelector("#lastRun");

const downloadSizes = [8, 16, 32].map((mb) => mb * 1024 * 1024);
const uploadSizes = [4, 8, 16].map((mb) => mb * 1024 * 1024);

serverLabel.textContent = window.location.host || "local server";

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return value >= 100 ? Math.round(value).toString() : value.toFixed(digits);
}

function setStatus(message) {
  statusText.textContent = message;
}

function setGauge(value, unit = "Mbps", color = "var(--green)") {
  const normalized = Math.max(0, Math.min(value / 250, 1));
  const dashOffset = 270 - normalized * 270;
  const rotation = -90 + normalized * 180;

  activeValue.textContent = Number.isFinite(value) ? formatNumber(value) : "--";
  activeUnit.textContent = unit;
  gaugeFill.style.strokeDashoffset = dashOffset;
  gaugeFill.style.stroke = color;
  needle.style.transform = `rotate(${rotation}deg)`;
}

function setMetric(element, value, digits = 1) {
  element.textContent = formatNumber(value, digits);
}

function now() {
  return performance.now();
}

async function timedFetch(url, options = {}) {
  const started = now();
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "Cache-Control": "no-store",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return { response, elapsed: now() - started };
}

async function measurePing() {
  const samples = [];

  for (let index = 0; index < 7; index += 1) {
    const { elapsed } = await timedFetch(`/api/ping?t=${Date.now()}-${index}`);
    samples.push(elapsed);
    setGauge(elapsed, "ms", "var(--cyan)");
    setStatus(`Checking latency ${index + 1}/7`);
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const jitter = samples.reduce((total, sample) => total + Math.abs(sample - median), 0) / samples.length;
  return { ping: median, jitter };
}

async function readDownload(response, onProgress) {
  const reader = response.body?.getReader();
  let bytes = 0;

  if (!reader) {
    const blob = await response.blob();
    onProgress(blob.size);
    return blob.size;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    onProgress(bytes);
  }

  return bytes;
}

async function measureDownload() {
  let best = 0;

  for (const size of downloadSizes) {
    let latestBytes = 0;
    const started = now();
    const response = await fetch(`/api/download?size=${size}&t=${Date.now()}`, { cache: "no-store" });

    if (!response.ok) throw new Error(`Download failed with ${response.status}`);

    const bytes = await readDownload(response, (loaded) => {
      latestBytes = loaded;
      const elapsedSeconds = Math.max((now() - started) / 1000, 0.001);
      const mbps = (loaded * 8) / elapsedSeconds / 1_000_000;
      setGauge(mbps, "Mbps", "var(--green)");
      setStatus(`Downloading ${Math.round(loaded / 1024 / 1024)} MB`);
    });

    const elapsedSeconds = Math.max((now() - started) / 1000, 0.001);
    const mbps = (bytes * 8) / elapsedSeconds / 1_000_000;
    best = Math.max(best, mbps);

    if (elapsedSeconds > 4 || latestBytes >= downloadSizes[downloadSizes.length - 1]) break;
  }

  return best;
}

function makeUploadPayload(size) {
  const payload = new Uint8Array(size);
  crypto.getRandomValues(payload.subarray(0, Math.min(size, 65536)));

  for (let offset = 65536; offset < size; offset += 65536) {
    payload.set(payload.subarray(0, Math.min(65536, size - offset)), offset);
  }

  return payload;
}

async function measureUpload() {
  let best = 0;

  for (const size of uploadSizes) {
    const body = makeUploadPayload(size);
    const started = now();

    await timedFetch(`/api/upload?t=${Date.now()}`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/octet-stream"
      }
    });

    const elapsedSeconds = Math.max((now() - started) / 1000, 0.001);
    const mbps = (size * 8) / elapsedSeconds / 1_000_000;
    best = Math.max(best, mbps);
    setGauge(mbps, "Mbps", "var(--yellow)");
    setStatus(`Uploaded ${Math.round(size / 1024 / 1024)} MB`);

    if (elapsedSeconds > 4) break;
  }

  return best;
}

async function runTest() {
  startButton.disabled = true;
  startButton.querySelector("span").textContent = "Testing...";
  setGauge(Number.NaN);
  pingValue.textContent = "--";
  jitterValue.textContent = "--";
  downloadValue.textContent = "--";
  uploadValue.textContent = "--";

  try {
    setStatus("Warming up connection");
    await timedFetch(`/api/ping?warmup=${Date.now()}`);

    const latency = await measurePing();
    setMetric(pingValue, latency.ping, 0);
    setMetric(jitterValue, latency.jitter, 0);

    setStatus("Measuring download speed");
    const downloadMbps = await measureDownload();
    setMetric(downloadValue, downloadMbps);

    setStatus("Measuring upload speed");
    const uploadMbps = await measureUpload();
    setMetric(uploadValue, uploadMbps);

    setGauge(downloadMbps, "Mbps", "var(--green)");
    setStatus("Test complete.");
    lastRun.textContent = new Date().toLocaleString();
  } catch (error) {
    console.error(error);
    setGauge(Number.NaN);
    setStatus("The test could not finish. Check the server and try again.");
  } finally {
    startButton.disabled = false;
    startButton.querySelector("span").textContent = "Start test";
  }
}

startButton.addEventListener("click", runTest);
