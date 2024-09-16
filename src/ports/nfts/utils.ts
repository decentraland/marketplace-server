export async function getBannedNames(listsServer: string): Promise<string[]> {
  try {
    const bannedNames = await fetch(`${listsServer}/banned-names`, {
      method: 'POST'
    })

    const data: { data: string[] } = await bannedNames.json()
    return data.data
  } catch (error) {
    console.error('Error fetching banned names: ', error)
    // if there was an error fetching the lists server, return an empty array
    return []
  }
}
