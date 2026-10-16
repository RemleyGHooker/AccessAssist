// Test files, each built with one known property so the correct response is never in doubt.
// Generated in code so the repo carries no binary test files.

const MB = 1024 * 1024;

const html = (body, lang = ' lang="en"') => `<!doctype html>\n<html${lang}>\n<head><title>Syllabus</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

function padHtmlTo(bytes) {
  const head = '<!doctype html>\n<html lang="en"><body><h1>Big file</h1><!--';
  const tail = '--></body></html>\n';
  return Buffer.from(head + 'x'.repeat(bytes - head.length - tail.length) + tail);
}

const PDF = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n';

export const fixtures = {
  accessibleHtml: { name: 'syllabus.html', type: 'text/html', data: Buffer.from(html('<h1>ECE 101</h1>\n<img src="map.png" alt="Campus map">')) },
  missingAltHtml: { name: 'lecture.html', type: 'text/html', data: Buffer.from(html('<h1>Week 1</h1>\n<img src="chart.png">')) },
  validPdf: { name: 'handout.pdf', type: 'application/pdf', data: Buffer.from(PDF) },
  truncatedPdf: { name: 'broken.pdf', type: 'application/pdf', data: Buffer.from(PDF.slice(0, 40)) },
  emptyFile: { name: 'empty.html', type: 'text/html', data: Buffer.alloc(0) },
  executable: { name: 'notes.exe', type: 'application/x-msdownload', data: Buffer.from('MZ\x90\x00 not a document') },
  exactlyMaxSize: { name: 'max.html', type: 'text/html', data: padHtmlTo(10 * MB) },
  overMaxSize: { name: 'too-big.html', type: 'text/html', data: padHtmlTo(10 * MB + 1) },
};
