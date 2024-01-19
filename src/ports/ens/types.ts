import { PNGStream } from 'canvas'

export type IENSComponent = {
  generateImage(ens: string, width: number, height: number, onlyLogo?: boolean): Promise<PNGStream>
}
