const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const colorInput = document.getElementById('color');
const thresholdInput = document.getElementById('threshold');
const turdInput = document.getElementById('turdSize');
const invertInput = document.getElementById('invert');
const result = document.getElementById('result');
const preview = document.getElementById('preview');
const errorPre = document.getElementById('error');
const btnDownload = document.getElementById('download');
const btnCopy = document.getElementById('copy');

function showError(msg, details) {
  errorPre.textContent = details ? `${msg}\n\n${details}` : msg;
  errorPre.classList.remove('hidden');
}

async function convert() {
  const params = new URLSearchParams({
    url: urlInput.value,
    color: colorInput.value,
    threshold: thresholdInput.value,
    turdSize: turdInput.value,
    invert: invertInput.checked ? 'true' : 'false'
  });
  const res = await fetch(`/vectorize?${params.toString()}`);
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch {}
    throw new Error(errText || `HTTP ${res.status}`);
  }
  return await res.text();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  result.classList.remove('hidden');
  errorPre.classList.add('hidden');
  preview.innerHTML = 'Converting…';
  try {
    const svg = await convert();
    preview.innerHTML = svg;

    btnDownload.onclick = () => {
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vectorized.svg';
      a.click();
      URL.revokeObjectURL(a.href);
    };

    btnCopy.onclick = async () => {
      await navigator.clipboard.writeText(svg);
      btnCopy.textContent = 'Copied!';
      setTimeout(() => (btnCopy.textContent = 'Copy SVG'), 1200);
    };
  } catch (err) {
    console.error('convert error', err);
    preview.textContent = '';
    showError('Conversion failed.', err.message);
  }
});