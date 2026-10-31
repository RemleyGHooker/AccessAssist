
  const $ = (id) => document.getElementById(id);
  const fileInput = $('file'), go = $('go'), drop = $('drop'), statusEl = $('status'), results = $('results');
  let chosen = null;
  let lastReport = null;

  const SAMPLES = {
    contrast: { name: 'contrast.html', type: 'text/html', body: '<!doctype html><html lang="en"><head><title>Course notice</title></head><body><p style="color:#aaa;background:#fff;font-size:16px">This text needs stronger contrast.</p></body></html>' },
    pdf: { name: 'figure.pdf', type: 'application/pdf', url: '/samples/missingAltPdf.pdf' },
    docx: { name: 'picture.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: '/samples/missingAltDocx.docx' },
    bad: { name: 'week1-lecture.html', type: 'text/html', body: '<!doctype html>\n<html>\n<head><title>Week 1</title></head>\n<body>\n<h1>Week 1: Circuits</h1>\n<img src="ohms-law.png">\n<p>See the diagram above.</p>\n<img src="lab-setup.jpg">\n</body>\n</html>\n' },
    good: { name: 'syllabus.html', type: 'text/html', body: '<!doctype html>\n<html lang="en">\n<head><title>Syllabus</title></head>\n<body>\n<h1>ECE 101 Syllabus</h1>\n<img src="map.png" alt="Map of the lab building">\n</body>\n</html>\n' },
    exe: { name: 'notes.exe', type: 'application/x-msdownload', body: 'MZ not a document' },
  };

  function choose(file) {
    chosen = file;
    $('dropTitle').textContent = file ? file.name : 'Choose a file or drop it here';
    $('dropHint').textContent = file ? `${(file.size / 1024).toFixed(1)} KB · ready to check` : 'HTML, PDF or Word (.docx), up to 10 MB';
    go.disabled = !file;
  }

  fileInput.addEventListener('change', () => choose(fileInput.files[0] || null));
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (ev) => { if (ev.dataTransfer.files[0]) choose(ev.dataTransfer.files[0]); });

  document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', async () => {
    const s = SAMPLES[b.dataset.sample];
    try {
      let data = s.body;
      if (s.url) {
        const response = await fetch(s.url);
        if (!response.ok) throw new Error('Sample unavailable');
        data = await response.arrayBuffer();
      }
      choose(new File([data], s.name, { type: s.type }));
      $('form').requestSubmit();
    } catch { statusEl.textContent = 'Could not load the sample. Please try again.'; }
  }));

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WCAG_NAMES = { '1.1.1': 'Non-text Content', '3.1.1': 'Language of Page', '1.3.1': 'Info and Relationships', '1.4.3': 'Contrast (Minimum)', '2.4.2': 'Page Titled', '4.1.2': 'Name, Role, Value' };

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!chosen) return;
    go.disabled = true; results.innerHTML = ''; statusEl.className = '';
    $('download').hidden = true;
    lastReport = null;
    statusEl.textContent = `Checking ${chosen.name}…`;
    const form = new FormData();
    form.append('file', chosen, chosen.name);
    form.append('wcag_level', new FormData($('form')).get('wcag_level'));
    try {
      const res = await fetch('/system/analyze', { method: 'POST', body: form });
      const body = await res.json();
      render(res.status, body);
    } catch {
      statusEl.className = 'bad';
      statusEl.textContent = 'Could not reach the service. Try again in a few seconds.';
    } finally { go.disabled = !chosen; }
  });

  function render(status, body) {
    $('download').hidden = status !== 200;
    lastReport = status === 200 ? body : null;
    if (status !== 200) {
      statusEl.className = 'bad';
      statusEl.textContent = `Not checked: ${body.message}`;
      results.innerHTML = `<div class="card"><div class="meta"><span class="pill critical">Error ${status}</span><code>${esc(body.code)}</code></div><p>Analysis could not be completed. No complete report was produced.</p></div>`;
      return;
    }
    const issues = body.issues || [];
    if (issues.length === 0) {
      const ran = (body.checks_run || []).length;
      statusEl.className = ran ? 'good' : '';
      statusEl.textContent = ran ? 'No supported problems found.' : 'Accepted, but not checked yet.';
      results.innerHTML = `<div class="card"><p>${esc(body.message)}</p>${ran ? `<p class="meta">Checks run: ${body.checks_run.map((c) => `<code>${esc(c)}</code>`).join(' ')}</p>` : ''}</div>`;
      return;
    }
    statusEl.className = 'bad';
    statusEl.textContent = `Found ${issues.length} accessibility problem${issues.length > 1 ? 's' : ''}.`;
    results.innerHTML = `<div class="card"><p>${esc(body.message || '')}</p><p class="meta">Checks run: ${(body.checks_run || []).map((c) => `<code>${esc(c)}</code>`).join(' ')}</p></div>` + issues.map((i) => `
      <article class="card">
        <div class="meta">
          <span class="pill ${esc(i.severity)}">${esc(i.severity)}</span>
          <span>WCAG ${esc(i.wcag_criterion)}${WCAG_NAMES[i.wcag_criterion] ? ' · ' + WCAG_NAMES[i.wcag_criterion] : ''}</span>
          ${i.location && i.location.line ? `<span>Line ${esc(i.location.line)}</span>` : ''}
          ${i.location && i.location.page ? `<span>Page ${esc(i.location.page)}</span>` : ''}
          ${i.location && i.location.selector ? `<code>${esc(i.location.selector)}</code>` : ''}
        </div>
        <h3>${esc(i.description)}</h3>
        ${i.location && i.location.snippet ? `<code>${esc(i.location.snippet)}</code>` : ''}
        <p class="fix"><b>How to fix:</b> ${esc(i.suggested_fix)}</p>
      </article>`).join('');
  }

  $('download').addEventListener('click', () => {
    if (!lastReport) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'accessassist-report.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
