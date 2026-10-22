// /api/leads.js — for a static HTML website deployed on Vercel.
// Do not expose GOOGLE_SCRIPT_URL or LEAD_SECRET in browser-side code.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({success:false,error:'Method not allowed'});
  try {
    const b = req.body || {};
    const clean = (x, max=250) => String(x ?? '').trim().slice(0,max);
    if (!clean(b.name) || !/^[6-9]\d{9}$/.test(clean(b.phone)) || !clean(b.course) || !clean(b.timeline) || b.consent !== true) {
      return res.status(400).json({success:false,error:'Invalid form fields'});
    }
    if (!process.env.GOOGLE_SCRIPT_URL || !process.env.LEAD_SECRET) throw new Error('Server configuration missing');
    const keys = ['name','phone','course','timeline','preferredContact','source','leadChannel','pageUrl','utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid','fbclid'];
    const lead = Object.fromEntries(keys.map(k => [k, clean(b[k], k==='pageUrl'?800:250)]));
    lead.secret = process.env.LEAD_SECRET;
    lead.submissionId = crypto.randomUUID();
    const response = await fetch(process.env.GOOGLE_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(lead), redirect:'follow', signal:AbortSignal.timeout(12000)
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) throw new Error('Google Sheets did not confirm saving');
    return res.status(200).json({success:true});
  } catch (err) {
    console.error('NIIB lead delivery failed:',err);
    return res.status(502).json({success:false,error:'Submission could not be saved. Please call admissions.'});
  }
}
