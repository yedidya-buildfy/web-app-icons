const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const tol = document.getElementById('tol');
const hard = document.getElementById('hard');
const feather = document.getElementById('feather');
const despeckle = document.getElementById('despeckle');
const result = document.getElementById('result');
const preview = document.getElementById('preview');
const preview2 = document.getElementById('preview2');
const btnDownload = document.getElementById('download');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  result.classList.add('hidden');
  const params = new URLSearchParams({
    url: urlInput.value,
    tol: tol.value,
    hard: hard.value,
    feather: feather.value,
    despeckle: despeckle.value
  });
  const res = await fetch(`/remove-bg?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    alert('Failed: ' + text);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  preview.src = url;
  preview2.src = url;
  result.classList.remove('hidden');
  btnDownload.onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'no-bg.png';
    a.click();
  };
});