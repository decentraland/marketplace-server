export const gradientColors = [
  { min: 2, max: 3, colors: ['#C640CD', '#691FA9'] }, // Purple gradient for name length 2-3
  { min: 4, max: 5, colors: ['#FF2D55', '#FFBC5B'] }, // Orange gradient for name length 4-5
  { min: 5, max: 6, colors: ['#73FFAF', '#1A9850'] }, // Green gradient for name length 5-6
  { min: 7, max: 8, colors: ['#81D1FF', '#3077E1'] }, // Blue gradient for name length 7-8
  { min: 9, max: 10, colors: ['#F6C1FF', '#FF4BED'] }, // Pink gradient for name length 9-10
  { min: 11, max: 15, colors: ['#FF9EB1', '#FF2D55'] } // Red gradient for name length 11-15 (max length)
]

export function getGradientColors(nameLength: number) {
  // Find the gradient that matches the length of the name
  const matchingGradient = gradientColors.find(gradient => nameLength >= gradient.min && nameLength <= gradient.max)
  // Return the colors if found, or default colors if no match
  return matchingGradient ? matchingGradient.colors : ['#000000', '#FFFFFF'] // Default to black and white if no match
}
