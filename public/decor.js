// Decoration only: the scene behind each page, and the dress on the product card.
// Nothing here touches payments; if it fails, the shop still works on a plain dark background.
const stage = document.querySelector('#stage')
// Wait for the fonts (or 300 ms) so the cards have their final size before a scene composes around them.
const settled = Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 300))])

if (stage.dataset.scene === 'galaxy') {
  const [{ mountGalaxy }, { mountShimmer }, { mountFloat }] = await Promise.all([
    import('/stage/galaxy.js'),
    import('/stage/shimmer.js'),
    import('/stage/float.js'),
  ])
  const card = document.querySelector('#status-card')
  await settled
  mountGalaxy(stage, { keepOut: card })
  mountShimmer(card, stage) // the card's water catches the galaxy's light
  // The words ride the water letter by letter; the status line (success.js rewrites it) and the
  // button ride as wholes.
  mountFloat(card, {
    texts: [...card.querySelectorAll(':scope > .label, :scope > h1, :scope > p:not(#proof)')],
    blocks: [...card.querySelectorAll('#proof, .pearl-button')],
  })
} else {
  const [{ mountRunway }, { mountDress }, { mountShimmer }, { mountFloat }] = await Promise.all([
    import('/stage/runway.js'),
    import('/product/dress.js'),
    import('/stage/shimmer.js'),
    import('/stage/float.js'),
  ])
  const card = document.querySelector('#card')
  const look = document.querySelector('#look')
  mountDress(look)
  await settled
  mountRunway(stage, { keepOut: [card, document.querySelector('#front-row')] })
  mountShimmer(card, stage) // the card's water catches the runway's light
  // Everything on the card rides the water: every word letter by letter, the controls as wholes.
  mountFloat(card, {
    art: look,
    texts: [...card.querySelectorAll('.product-info > .label, .product-info h1, .blurb, .price, .hint')],
    blocks: [...card.querySelectorAll('#name, .buy .pearl-button, #status')],
  })
}
