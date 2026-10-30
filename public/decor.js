// Decoration only: the scene behind each page, and the water each card is made of.
// Nothing here touches payments; if it fails, the shop still works on a plain dark background.
const stage = document.querySelector('#stage')
// Wait for the fonts (or 300 ms) so the cards have their final size before a scene composes around them.
const settled = Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 300))])
const words = (card) => [...card.querySelectorAll('.ripple-text')]

if (stage.dataset.scene === 'galaxy') {
  const [{ mountGalaxy }, { mountWater }] = await Promise.all([import('/stage/galaxy.js'), import('/stage/water.js')])
  const card = document.querySelector('#status-card')
  await settled
  mountGalaxy(stage) // stars behind the card too: the water needs something to bend
  mountWater(card, { stage, texts: words(card), light: [255, 168, 214] }) // calm water in the planet's pink
} else {
  const card = document.querySelector('#card')
  const look = document.querySelector('#look')
  // The dress is a picture, with notes on where its hem is and where water drips and runs on it.
  // The water draws it once both are in; a picture that won't load is left out.
  const notes = fetch('/product/strawberry-slip-look.json')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
  const picture = look.decode().then(
    () => look,
    () => null,
  )
  const [{ mountRunway }, { mountWater }] = await Promise.all([import('/stage/runway.js'), import('/stage/water.js')])
  await settled
  mountRunway(stage, { keepOut: [card, document.querySelector('#front-row')] })
  const [art, meta] = await Promise.all([picture, notes])
  mountWater(card, { stage, art, meta, texts: words(card), rain: true }) // rain on the water, the dress over it
}
