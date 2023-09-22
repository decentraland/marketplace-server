const fs = require('fs')
const readline = require('readline')

const wrongOrders = {}
const rightOrders = {}

async function processLineByLine(file, outputObject) {
  const fileStream = fs.createReadStream(file)

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity // To handle all instances of CR LF ('\r\n') in the input as a single line break.
  })

  let headers = []
  let isFirstLine = true

  for await (const line of rl) {
    if (isFirstLine) {
      headers = line.split(',')
      isFirstLine = false
    } else {
      const values = line.split(',')
      const row = {}
      headers.forEach((header, index) => {
        row[header] = values[index]
      })
      outputObject[row.id] = row.status
    }
  }
}

async function main(rightOrdersFileName, wrongOrdersFileName, schema, outputFileName) {
  await processLineByLine(rightOrdersFileName, rightOrders)
  await processLineByLine(wrongOrdersFileName, wrongOrders)
  const queries = []
  Object.entries(wrongOrders).forEach(([id, status]) => {
    const rightEntry = rightOrders[id]
    if (status !== rightEntry) {
      queries.push(`UPDATE "${schema}"."orders" SET "status" = E'${rightEntry.replace(/"/g, '')}' WHERE "id" = E'${id.replace(/"/g, '')}';`)
    }
  })

  // Convert array to a single string and write to file
  const queriesString = queries.join('\n')
  fs.writeFileSync(outputFileName, queriesString)

  console.log('length:', queries.length)
  console.log('finished')
}

main('right_orders_eth.csv', 'wrong_orders_eth.csv', 'dcl19', 'output_queries_eth.sql')
