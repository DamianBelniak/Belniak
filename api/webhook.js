// /api/webhook.js
// Odbiera zdarzenia ze Stripe. Gdy płatność się powiedzie (checkout.session.completed),
// wysyła Tobie e-mail z pełnym opisem zamówienia (produkty, rozmiary, adres, kontakt).
//
// WAŻNE: ten endpoint MUSI dostawać surowe (nieprzetworzone) body, inaczej
// weryfikacja podpisu Stripe się nie powiedzie — stąd config poniżej i ręczne
// czytanie strumienia zamiast req.body.

const Stripe = require('stripe');

module.exports.config = {
  api: { bodyParser: false }
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendOrderEmail(session, lineItems) {
  const items = lineItems.data.map((li) => {
    const qty = li.quantity;
    const amount = (li.amount_total / 100).toFixed(2);
    return `• ${li.description} × ${qty} — ${amount} €`;
  }).join('\n');

  const customerEmail = (session.customer_details && session.customer_details.email) || session.customer_email || '(brak)';
  const customerName = (session.customer_details && session.customer_details.name) || '(brak)';
  const phone = (session.customer_details && session.customer_details.phone) || '(brak)';

  const addr = (session.customer_details && session.customer_details.address) || session.shipping_details && session.shipping_details.address;
  const addressStr = addr
    ? [addr.line1, addr.line2, [addr.postal_code, addr.city].filter(Boolean).join(' '), addr.state, addr.country].filter(Boolean).join('\n')
    : '(brak adresu)';

  const total = (session.amount_total / 100).toFixed(2);

  const html = `
    <h2>Nowe zamówienie — Belniak Posters</h2>
    <p><b>Kwota:</b> ${total} EUR</p>
    <p><b>Produkty:</b><br>${items.replace(/\n/g, '<br>')}</p>
    <p><b>Klient:</b> ${customerName}<br>
       <b>E-mail:</b> ${customerEmail}<br>
       <b>Telefon:</b> ${phone}</p>
    <p><b>Adres wysyłki:</b><br>${addressStr.replace(/\n/g, '<br>')}</p>
    <p><b>Stripe Checkout Session:</b> ${session.id}</p>
  `.trim();

  const text = `Nowe zamówienie — Belniak Posters
Kwota: ${total} EUR

Produkty:
${items}

Klient: ${customerName}
E-mail: ${customerEmail}
Telefon: ${phone}

Adres wysyłki:
${addressStr}

Stripe Checkout Session: ${session.id}`;

  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY nieustawiony — pomijam wysyłkę maila, dane zamówienia:\n', text);
    return;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || 'Belniak Orders <onboarding@resend.dev>',
      to: [process.env.NOTIFY_EMAIL || 'artur.belniak@gmail.com'],
      subject: `Nowe zamówienie — ${total} EUR — ${customerEmail}`,
      html,
      text
    })
  });

  if (!resp.ok) {
    console.error('Resend error:', resp.status, await resp.text());
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end('Method not allowed');
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const sessionSummary = event.data.object;
      const session = await stripe.checkout.sessions.retrieve(sessionSummary.id, {
        expand: ['customer_details']
      });
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionSummary.id, { limit: 100 });
      await sendOrderEmail(session, lineItems);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Zwracamy 200 mimo błędu wysyłki maila, żeby Stripe nie zarzucał nas retry —
    // sama płatność już przeszła, więc to nie jest błąd transakcji.
    res.status(200).json({ received: true, notifyError: true });
  }
};
