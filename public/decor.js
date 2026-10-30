// Decoration only: the scene behind each page, the dress, and the water each card is made of.
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
  const [{ mountRunway }, { mountDress }, { mountWater }] = await Promise.all([
    import('/stage/runway.js'),
    import('/product/dress.js'),
    import('/stage/water.js'),
  ])
  const card = document.querySelector('#card')
  const look = document.querySelector('#look')
  mountDress(look)
  await settled
  mountRunway(stage, { keepOut: [card, document.querySelector('#front-row')] })
  mountWater(card, { stage, art: look, texts: words(card), rain: true }) // rain on the water, the dress in it
}
