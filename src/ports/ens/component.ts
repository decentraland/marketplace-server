import { PNGStream, createCanvas, loadImage, registerFont } from 'canvas'
import { IENSComponent } from './types'
import { getGradientColors } from './utils'

export function createENS(): IENSComponent {
  async function generateImage(name: string, width: number, height: number, onlyLogo?: boolean): Promise<PNGStream> {
    // register the font first
    registerFont('src/fonts/Inter/Inter-SemiBold.ttf', { family: 'Inter', weight: '600' })
    // Create a canvas and get the context
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')

    const borderRadius = 8
    let nameYPosition = 0
    // Create a rounded rectangle path
    ctx.beginPath()
    ctx.moveTo(borderRadius, 0)
    ctx.lineTo(width - borderRadius, 0)
    ctx.quadraticCurveTo(width, 0, width, borderRadius)
    ctx.lineTo(width, height - borderRadius)
    ctx.quadraticCurveTo(width, height, width - borderRadius, height)
    ctx.lineTo(borderRadius, height)
    ctx.quadraticCurveTo(0, height, 0, height - borderRadius)
    ctx.lineTo(0, borderRadius)
    ctx.quadraticCurveTo(0, 0, borderRadius, 0)
    ctx.closePath()

    // Clip the path so everything drawn afterwards will be within rounded corners
    ctx.clip()

    // Generate gradient based on the name length
    const colors = getGradientColors(name.length)

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, colors[0])
    gradient.addColorStop(1, colors[1])
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    if (!onlyLogo) {
      ctx.font = '600 24px Inter' // This sets the font weight to 600 and the font size to 40px
      ctx.fillStyle = '#FCFCFC'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Calculate the vertical center for the name
      nameYPosition = height / 2 + 10 // Adjust as needed
      ctx.fillText(name, width / 2, nameYPosition)

      ctx.font = '700 16px Inter' // This sets the font weight to700 and the font size to 18px
      ctx.fillStyle = '#FCFCFCCC'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const dclEthYPosition = nameYPosition + 30 // Position "DCL.ETH" below the name
      ctx.fillText('DCL.ETH', width / 2, dclEthYPosition)
    }

    // Load and draw the logo
    const logo = await loadImage('src/images/logo_dcl.svg')
    const logoWidth = onlyLogo ? width * 0.8 : 40 // LOGO WIDTH
    const logoHeight = onlyLogo ? height * 0.8 : 40 // LOGO HEIGHT
    const logoXPosition = width / 2 - logoWidth / 2 // Center the logo
    const logoYPosition = onlyLogo ? height / 2 - logoHeight / 2 : nameYPosition - logoHeight - 25 // Adjust space above the name
    ctx.drawImage(logo, logoXPosition, logoYPosition, logoWidth, logoHeight)

    return canvas.createPNGStream()
  }

  return {
    generateImage
  }
}
