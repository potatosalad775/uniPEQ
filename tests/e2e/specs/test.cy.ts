describe('uniPEQ smoke test', () => {
  it('shows the Main tab with the demo device', () => {
    cy.visit('/')
    cy.contains('ion-title', 'uniPEQ')
    cy.contains('ion-item', 'Demo DAC')
  })
})
