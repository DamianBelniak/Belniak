// /api/create-checkout-session.js
const Stripe = require('stripe');

const PRODUCTS = [
  { slug: 'bmw-m12-nazca', name: 'BMW Nazca M12' },
  { slug: 'mercedes-benz-in-aller-welt', name: 'Mercedes in aller Welt' },
  { slug: 'volkswagen-syncro-w12', name: 'Volkswagen Syncro' },
  { slug: 'mercedes-slr', name: 'Mclaren SLR' },
  { slug: 'bmw-e39', name: 'BMW E38' },
  { slug: 'mercedes-sls-amg-gt3', name: 'Mercedes SLS AMG GT3' },
  { slug: 'vw-golft-r32-jet-black', name: 'Volkswagen Golf R32 Jet Black' },
  { slug: 'maseratti-gt', name: 'Maseratti GT' },
  { slug: 'vw-passat-w8', name: 'Volkswagen Passat W8' },
  { slug: 'vw-golf-gti', name: 'Volkswagen Golf GTI' },
  { slug: 'vw-touareg', name: 'Volkswagen Touareg' },
  { slug: '125', name: 'Mercedes-Benz 125 years' },
  { slug: 'mercedes-63-amg', name: 'Mercedes 63 AMG' },
  { slug: 'lamborghini-diablo', name: 'Lamborghini Diablo' },
  { slug: 'bmw-z4', name: 'BMW Z4' },
  { slug: 'audi-r8', name: 'Audi R8' },
  { slug: 'audi-q7', name: 'Audi Q7' },
  { slug: 'audi-rs6-avant', name: 'Audi RS6 Avant' }
];
const BY_SLUG = {};
PRODUCTS.forEach(function (p) { BY_SLUG[p.slug] = p; });

const PRICES = { '3042': 20, '4060': 25, '5070': 30 }; // EUR
const SIZE_LABELS = { '3042': '30×42 cm', '4060': '40×60 cm', '5070': '50×70 cm' };

// Produkt testowy — do sprawdzenia realnej płatności małą kwotą.
// Stripe ma minimalną kwotę transakcji (dla PLN to zwykle ok. 2.00 zł) —
// jeśli sesja się nie utworzy / płatność odrzuci przez zbyt niską kwotę,
// podnieś TEST_PRICE_GROSZ do 200 (2.00 zł).
const TEST_SLUG = 'test-1zl';
const TEST_PRICE_GROSZ = 100; // 1.00 zł
BY_SLUG[TEST_SLUG] = { slug: TEST_SLUG, name: 'TEST — 1 zł (do testu płatności)' };

const SHIP_COUNTRIES = [
  'PL','DE','FR','GB','IE','IT','ES','PT','NL','BE','LU','AT','CH','SE','NO','DK','FI','IS',
  'CZ','SK','HU','RO','BG','HR','SI','GR','EE','LV','LT','MT','CY',
  'US','CA','AU','NZ','JP','KR','SG','HK','TW','AE','SA','IL',
  'BR','MX','AR','CL','CO','ZA','IN'
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const SITE_URL = process.env.SITE_URL || `https://${req.headers.host}`;

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const cart = Array.isArray(body.cart) ? body.cart : [];

    if (!cart.length) {
      res.status(400).json({ error: 'Koszyk jest pusty.' });
      return;
    }

    const cartHasTest = cart.some((i) => i && i.slug === TEST_SLUG);
    const cartHasReal = cart.some((i) => i && i.slug !== TEST_SLUG);
    if (cartHasTest && cartHasReal) {
      res.status(400).json({ error: 'Produkt testowy nie może być w koszyku razem z innymi produktami.' });
      return;
    }

    const line_items = [];
    for (const raw of cart) {
      const product = BY_SLUG[raw && raw.slug];
      const qty = Math.max(1, Math.min(20, parseInt(raw && raw.qty, 10) || 1));

      if (!product) {
        res.status(400).json({ error: 'Nieprawidłowa pozycja w koszyku.' });
        return;
      }

      if (product.slug === TEST_SLUG) {
        line_items.push({
          quantity: qty,
          price_data: {
            currency: 'pln',
            unit_amount: TEST_PRICE_GROSZ,
            product_data: {
              name: product.name,
              metadata: { slug: product.slug, test: 'true' }
            }
          }
        });
        continue;
      }

      const size = raw && raw.size;
      if (!PRICES[size]) {
        res.status(400).json({ error: 'Nieprawidłowa pozycja w koszyku.' });
        return;
      }

      line_items.push({
        quantity: qty,
        price_data: {
          currency: 'eur',
          unit_amount: PRICES[size] * 100,
          product_data: {
            name: product.name + ' — ' + SIZE_LABELS[size],
            metadata: { slug: product.slug, size: size }
          }
        }
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: line_items,
      shipping_address_collection: { allowed_countries: SHIP_COUNTRIES },
      phone_number_collection: { enabled: true },
      success_url: SITE_URL + '/?success=true&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: SITE_URL + '/?canceled=true',
      metadata: {
        cart: JSON.stringify(cart).slice(0, 490)
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: 'Nie udało się utworzyć sesji płatności.' });
  }
};
