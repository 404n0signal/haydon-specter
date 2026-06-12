// Form backend: validates submissions from the two site forms and relays them
// to info@haydonspecter.com via Resend. CV arrives as base64 in the JSON body
// (no multipart parsing) and is forwarded as an email attachment.

const REQUIRED = {
  brief: ['name', 'email', 'message'],
  terms: ['tname', 'trole', 'tcompany', 'temail', 'tcqc', 'tbeds'],
};

const LABELS = {
  brief: [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['type', 'Enquirer type'], ['message', 'Message']],
  terms: [['tname', 'Name'], ['trole', 'Role'], ['tcompany', 'Care home / company'], ['temail', 'Work email'], ['tcqc', 'CQC provider ID'], ['tbeds', 'Beds / clients'], ['tdeclare', 'Provider declaration']],
};

const SUBJECTS = {
  brief: 'New enquiry — Haydon Specter website',
  terms: 'New Terms request — Haydon Specter website',
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  const body = req.body || {};
  const kind = body.form === 'terms' ? 'terms' : 'brief';

  // Honeypot: bots fill the hidden checkbox — report success, send nothing
  if (body.botcheck) return res.status(200).json({ success: true });

  for (const f of REQUIRED[kind]) {
    if (!body[f] || !String(body[f]).trim()) {
      return res.status(400).json({ success: false, message: 'Missing required field: ' + f });
    }
  }
  const replyTo = String(kind === 'terms' ? body.temail : body.email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    return res.status(400).json({ success: false, message: 'Invalid email address' });
  }
  if (kind === 'terms' && body.tdeclare !== true) {
    return res.status(400).json({ success: false, message: 'Declaration not confirmed' });
  }

  const rows = LABELS[kind]
    .map(([key, label]) => [label, body[key]])
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([label, v]) =>
      `<tr><td style="padding:6px 14px 6px 0;color:#6B6358;vertical-align:top;white-space:nowrap">${label}</td>` +
      `<td style="padding:6px 0">${esc(v === true ? 'Confirmed' : v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('');

  const email = {
    from: 'Haydon Specter Website <noreply@updates.haydonspecter.com>',
    to: ['info@haydonspecter.com'],
    reply_to: replyTo,
    subject: SUBJECTS[kind],
    html:
      `<div style="font-family:system-ui,sans-serif;color:#2A2622;max-width:620px">` +
      `<h2 style="color:#16335B;font-weight:600">${SUBJECTS[kind]}</h2>` +
      `<table style="border-collapse:collapse;font-size:15px">${rows}</table>` +
      `<p style="margin-top:22px;font-size:13px;color:#6B6358">Reply to this email to respond directly to the enquirer.</p>` +
      `</div>`,
  };

  if (kind === 'brief' && body.cv && body.cv.content) {
    const filename = String(body.cv.filename || 'cv').replace(/[^\w. -]/g, '_');
    if (!/\.(pdf|doc|docx)$/i.test(filename)) {
      return res.status(400).json({ success: false, message: 'CV must be a PDF or Word document' });
    }
    if (String(body.cv.content).length > 4200000) {
      return res.status(400).json({ success: false, message: 'CV too large (3MB max)' });
    }
    email.attachments = [{ filename, content: body.cv.content }];
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(email),
  });
  if (!r.ok) {
    console.error('Resend error', r.status, await r.text());
    return res.status(502).json({ success: false, message: 'Email send failed' });
  }
  return res.status(200).json({ success: true });
};
