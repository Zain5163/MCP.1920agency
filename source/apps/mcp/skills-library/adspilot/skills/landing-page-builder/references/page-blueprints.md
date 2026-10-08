# Landing page blueprints

**Updated 2026-10-08.** Section-by-section outlines for the page types in the
landing-page-builder skill. Each is a starting order, not a template to fill blindly:
drop a section the buyer does not need, and never fill one with invented content. Words
come from the owner's facts, written with `copywriting`.

Mark every placeholder you cannot fill as **[ASK OWNER: …]** and list them in your reply.

Before using a blueprint, know the target country and read its reference in
`get_skill selling-by-country`: it changes the payment line, how prices and discounts are
shown, the returns wording, the legal notice and the final button's words.

## A. Product sale page (one product or a small set)

1. **First screen:** the ad's promise as the headline; product photo matching the ad;
   price (with tax shown as the market expects, and a real "was" price that meets its
   discount rule); variant selector if needed; buy button; trust line (delivery time,
   payment options the market expects such as cash on delivery, buy now pay later or local
   methods, and the return or exchange term).
2. **Why this product:** 3–5 benefits in the buyer's words, each tied to a feature
   ("Rubber sole that grips on wet floors"), with a photo for each where possible.
3. **Proof:** real reviews with names or initials and city, customer photos, ratings with
   their count. If there are none yet, use specifics instead (materials, process, guarantee).
4. **Details:** size guide or dimensions, materials, what is in the box, care.
5. **Objections (FAQ):** delivery time and cost, payment options (cash on delivery where
   offered), exchanges and returns (with the legal withdrawal right where the market has
   one), original or copy, warranty or legal guarantee, and how to order by chat where
   buyers use WhatsApp.
6. **Offer again:** bundle or free delivery threshold if there is one, with its end date.
7. **Final call to action** and the contact route.

On Shopify this is usually the product page itself or a `product.<name>.json` template.

## B. Cash-on-delivery order page (COD markets such as Pakistan, India and the Gulf)

Use when the store sells one hero product to buyers who prefer to order without a full
checkout. On Shopify, prefer the normal cart and checkout with cash on delivery enabled:
it keeps orders, stock and the Purchase event in one place. Build a page form only when
the owner already uses an order-form app.

1. First screen as in A, with "Order now, pay on delivery" as the action.
2. Short proof and benefits.
3. **Order form:** name, phone (WhatsApp), city, address, size or quantity, a note.
   Total price including delivery shown before submit.
4. **Thank-you step:** order number, "we will confirm on WhatsApp within [ASK OWNER]",
   delivery time; the Purchase event fires here with value and currency.

## C. Lead page (services, high-price items, bookings)

1. **First screen:** headline restating the ad's promise; who it is for; one image of the
   result or the people; a short form or a button that scrolls to it.
2. **What you get:** the service in 3–5 concrete points; price or "from" price if the
   owner shares it (hidden prices lower lead quality and raise follow-up time).
3. **How it works:** 3 steps from enquiry to result, with time frames.
4. **Proof:** client results with permission, reviews, certifications, years in business.
5. **Objections (FAQ):** price, timing, area served, what happens after the form.
6. **Form again**, and a phone, email or chat alternative (WhatsApp where the market uses it).
7. **Thank-you page:** what happens next and when; the Lead event fires here.

## D. Chat or call page (only when the buyer needs detail first)

Use the channel the market's buyers already use and the owner actually answers: WhatsApp
is the norm in Pakistan, India and the Gulf; in other markets it may be WhatsApp,
Messenger, SMS, live chat or a phone call. Ask the owner; do not assume.

1. First screen: the promise, one image, and a large "Chat on WhatsApp" button
   (`https://wa.me/<number>?text=<pre-filled message naming the product or ad>`), plus
   tap-to-call (`tel:`) if calls are answered.
2. Three reasons to message now (stock, fit advice, quick quote).
3. Opening hours and expected reply time.
4. The Contact event fires on the tap.

## E. Event or sign-up page

1. Name of the event, date, time, place or link, and who it is for.
2. What attendees get (agenda or outcomes), speakers or hosts with photos.
3. Registration form (name, and email, or WhatsApp where the audience prefers it;
   nothing else unless required). Marketing consent as its own choice where the market
   requires it.
4. Confirmation page with calendar link; CompleteRegistration or Lead fires there.

## Copy rules shared by every blueprint

- The headline is a promise the business can keep, in the words the ad used.
- Specific beats vague: "Delivered in 2–3 working days in Lahore" or "Order by 2 pm for
  next-day delivery in mainland UK" beats "Fast delivery" (only the owner's real terms).
- One idea per section, short paragraphs, descriptive subheads.
- Buttons say what happens: "Order now, pay on delivery", "Get my quote", "Chat on WhatsApp".
  The final order button in the EU and UK must make clear the order means paying (in
  Germany "zahlungspflichtig bestellen" or equally clear words); "Submit" or "Continue"
  is not enough there.
- Write in the buyer's language and spelling (UK "colour", US "color"), with the market's
  currency and number format.
- No AI tells (see `copywriting`, its "No AI Tells" section): no "it's not X, it's Y"
  constructions, no stacked adjectives, no empty superlatives.
