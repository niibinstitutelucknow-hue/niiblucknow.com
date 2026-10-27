
const allowedHosts = new Set([
  'niiblucknow.com',
  'www.niiblucknow.com'
]);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const clean = (x, max = 250) =>
    String(x ?? '').trim().slice(0, max);

  try {
    const b = req.body || {};

    if (
      !clean(b.name) ||
      !/^[6-9]\d{9}$/.test(clean(b.phone)) ||
      !clean(b.course) ||
      !clean(b.timeline) ||
      b.consent !== true
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid form fields'
      });
    }

    if (
      !process.env.GOOGLE_SCRIPT_URL ||
      !process.env.LEAD_SECRET ||
      !process.env.TURNSTILE_SECRET_KEY
    ) {
      throw new Error('Missing server configuration');
    }

    // Cloudflare Turnstile verification
    const token = clean(b.turnstileToken, 2048);

    if (!token) {
      return res.status(403).json({
        success: false,
        error: 'Security verification required'
      });
    }

    const verificationRequest = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          secret: process.env.TURNSTILE_SECRET_KEY,
          response: token
        }),
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!verificationRequest.ok) {
      throw new Error('Turnstile service unavailable');
    }

    const verification = await verificationRequest.json();

    if (
      !verification.success ||
      !allowedHosts.has(verification.hostname)
    ) {
      return res.status(403).json({
        success: false,
        error: 'Security verification failed'
      });
    }

    const keys = [
      'name', 'phone', 'course', 'timeline',
      'preferredContact', 'source', 'leadChannel',
      'pageUrl', 'utm_source', 'utm_medium',
      'utm_campaign', 'utm_content', 'utm_term',
      'gclid', 'gbraid', 'wbraid', 'fbclid'
    ];

    const lead = Object.fromEntries(
      keys.map(k => [
        k,
        clean(b[k], k === 'pageUrl' ? 800 : 250)
      ])
    );

    // Marketing attribution is not verified click proof.
    const src = lead.utm_source.toLowerCase();
    const medium = lead.utm_medium.toLowerCase();

    let channel = 'Direct / Unknown';

    if (src === 'google' && medium === 'cpc') {
      channel = 'Google Ads - Unverified';
    } else if (
      ['facebook', 'instagram', 'meta', 'fb', 'ig']
        .includes(src)
    ) {
      channel = 'Meta Ads - Unverified';
    } else if (src) {
      channel = 'Other / ' + src;
    }

    lead.leadChannel = channel;
    lead.source = channel;
    lead.secret = process.env.LEAD_SECRET;
    lead.submissionId = crypto.randomUUID();

    // Existing Google Sheets integration
    const response = await fetch(
      process.env.GOOGLE_SCRIPT_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(lead),
        redirect: 'follow',
        signal: AbortSignal.timeout(12000)
      }
    );

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error('Google Sheets save failed');
    }

    return res.status(200).json({
      success: true
    });

  } catch (err) {
    console.error('NIIB lead delivery failed:', err.message);

    return res.status(502).json({
      success: false,
      error: 'Submission could not be saved. Please call admissions.'
    });
  }
}
