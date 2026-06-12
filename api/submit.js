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

const KICKERS = {
  brief: 'New website enquiry',
  terms: 'Terms of Business request',
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// On-brand, email-client-safe shell (tables + inline styles; Georgia stands in
// for Fraunces since webfonts don't load in most email clients)
function renderEmail(kind, rows, replyName) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<body style="margin:0;padding:0;background:#F4ECE0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4ECE0;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFCF7;border:1px solid #E9DECF;border-radius:18px;overflow:hidden;">
  <tr><td style="background:#16335B;padding:30px 38px;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:600;color:#FBF6EE;letter-spacing:-0.3px;">Haydon Specter<span style="color:#C56B4A;">.</span></span>
    <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#C8A24B;padding-top:10px;">${KICKERS[kind]}</div>
  </td></tr>
  <tr><td style="padding:34px 38px 10px;">
    <p style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:19px;color:#16335B;">${kind === 'terms' ? 'A care provider has requested your Terms of Business.' : 'Someone has sent an enquiry through the website.'}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:15px;color:#2A2622;">
${rows}
    </table>
  </td></tr>
  <tr><td style="padding:8px 38px 34px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#FBF6EE;border-left:3px solid #C56B4A;border-radius:0 10px 10px 0;padding:14px 18px;font-family:Arial,sans-serif;font-size:13px;color:#6B6358;">
        Hit <strong style="color:#16335B;">Reply</strong> to respond directly to ${esc(replyName)}.
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#FBF6EE;border-top:1px solid #E9DECF;padding:20px 38px;font-family:Arial,sans-serif;font-size:11px;line-height:1.6;color:#6B6358;">
    Haydon Specter Ltd &middot; 124 City Road, London, EC1V 2NX &middot; Sent automatically from haydonspecter.com
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
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
      `<tr><td style="padding:11px 16px 11px 0;color:#6B6358;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;vertical-align:top;white-space:nowrap;border-bottom:1px solid #E9DECF;">${label}</td>` +
      `<td style="padding:11px 0;color:#2A2622;border-bottom:1px solid #E9DECF;">${esc(v === true ? 'Confirmed' : v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('\n');

  const enquirerName = String(kind === 'terms' ? body.tname : body.name).trim();
  const subject = kind === 'terms'
    ? `Terms request — ${String(body.tcompany).trim()}`
    : `New enquiry — ${enquirerName}`;

  const email = {
    from: 'Haydon Specter Website <noreply@updates.haydonspecter.com>',
    to: ['info@haydonspecter.com'],
    reply_to: replyTo,
    subject,
    html: renderEmail(kind, rows, enquirerName),
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
