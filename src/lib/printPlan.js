// Opens a print-friendly HTML page for the current game plan.
// Extracted from App.jsx to keep the main component leaner.

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function printPlan({ plan, course, playerInfo, teeDate, teeTime }) {
  const cleanPlan = plan.replace(/```green-json\s*\n[\s\S]*?\n```/g, '')
  const html = esc(cleanPlan)
    .replace(/^## (.+)$/gm, '</p><h2>$1</h2><p>')
    .replace(/^### (.+)$/gm, '</p><h3>$1</h3><p>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<div class="li">$1</div>')
    .replace(/^\d+\.\s+(.+)$/gm, '<div class="li">$1</div>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
  const doc = `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Game Plan — ${esc(course.name || 'Golf')}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;
          max-width:640px;margin:0 auto;padding:16px;color:#1a1a1a;line-height:1.6;font-size:14px;
          -webkit-text-size-adjust:100%}
        .header{background:#1a4d2e;color:#fff;padding:16px;border-radius:10px;margin-bottom:16px}
        .header h1{font-size:18px;font-weight:700;margin-bottom:4px}
        .header .meta{font-size:12px;color:#a8d5ba;line-height:1.5}
        h2{font-size:16px;font-weight:700;color:#1a4d2e;margin:20px 0 8px;padding:8px 0 4px;border-bottom:2px solid #e8e8e8}
        h3{font-size:14px;font-weight:600;color:#333;margin:14px 0 4px}
        p{margin:4px 0 8px;font-size:14px}
        strong{color:#111;font-weight:600}
        .li{padding:3px 0 3px 16px;position:relative;font-size:13px;line-height:1.5}
        .li::before{content:"▸";position:absolute;left:0;color:#1a4d2e}
        .hole-card{border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin:10px 0;page-break-inside:avoid}
        @media print{
          body{padding:12px;font-size:13px}
          .header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
          h2{page-break-after:avoid}
          .hole-card{page-break-inside:avoid}
        }
        @media(max-width:480px){
          body{padding:12px;font-size:13px}
          h2{font-size:15px}
          .header h1{font-size:16px}
        }
      </style></head><body>
      <div class="header">
        <h1>${esc(course.name || 'Game Plan')}</h1>
        <div class="meta">
          ${esc(playerInfo.name || 'Player')} · HCP ${esc(playerInfo.handicap)}<br>
          ${esc(teeDate)} · ${esc(teeTime)} · Par ${esc(course.par)} · ${Number(course.yardage || 0).toLocaleString()}y<br>
          ${course.selectedTee ? esc(course.selectedTee) + ' tees · ' : ''}${course.conditions ? esc(course.conditions) : ''}
        </div>
      </div>
      <p>${html}</p>
    </body></html>`
  const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }))
  const w = window.open(url, '_blank')
  w?.addEventListener('load', () => { w.print(); URL.revokeObjectURL(url) })
}
