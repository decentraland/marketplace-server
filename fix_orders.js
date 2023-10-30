// Since we can't use triggers during the indexing time to avoid throtteling the database, we had to do it after the indexing was done.
// This is a script that receives the orders that were wrong and the orders that were right and outputs a file with the queries to fix the wrong orders.
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
    if (rightEntry && status !== rightEntry) {
      queries.push(`UPDATE "${schema}"."orders" SET "status" = E'${rightEntry.replace(/"/g, '')}' WHERE "id" = E'${id.replace(/"/g, '')}';`)
    } else if (!rightEntry) {
      console.log('id not found in right entries: ', id)
    }
  })

  // Convert array to a single string and write to file
  const queriesString = queries.join('\n')
  fs.writeFileSync(outputFileName, queriesString)

  console.log('finished')
}

main('right_orders_dcl32.csv', 'wrong_orders_dcl32.csv', 'dcl32', 'output_queries_dcl32.sql')
