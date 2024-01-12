import { PNGStream, createCanvas, loadImage, registerFont } from 'canvas'
import { IENSComponent } from './types'
import { getGradientColors } from './utils'

export function createENS(): IENSComponent {
  async function generateImage(name: string, width: number, height: number): Promise<PNGStream> {
    // register the font first
    registerFont('src/fonts/Inter/Inter-SemiBold.ttf', { family: 'Inter', weight: '600' })
    // Create a canvas and get the context
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')

    // Generate gradient based on the name length
    const colors = getGradientColors(name.length)

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, colors[0])
    gradient.addColorStop(1, colors[1])
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // Set the font style for the name using the 'Inter' font
    ctx.font = '600 40px Inter' // This sets the font weight to 600 and the font size to 40px
    ctx.fillStyle = '#FCFCFC'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Calculate the vertical center for the name
    const nameYPosition = height / 2 + 20 // Adjust as needed
    ctx.fillText(name, width / 2, nameYPosition)

    ctx.font = '700 18px Inter' // This sets the font weight to700 and the font size to 18px
    ctx.fillStyle = '#FCFCFCCC'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const dclEthYPosition = nameYPosition + 45 // Position "DCL.ETH" below the name
    ctx.fillText('DCL.ETH', width / 2, dclEthYPosition)

    // Load and draw the logo
    const logo = await loadImage('src/images/logo_dcl.svg')
    const logoWidth = 53.602 // LOGO WIDTH
    const logoHeight = 54 // LOGO HEIGHT
    const logoXPosition = width / 2 - logoWidth / 2 // Center the logo
    const logoYPosition = nameYPosition - logoHeight - 30 // Adjust space above the name
    ctx.drawImage(logo, logoXPosition, logoYPosition, logoWidth, logoHeight)

    return canvas.createPNGStream()
  }

  return {
    generateImage
  }
}
