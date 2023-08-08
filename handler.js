'use strict';
const {DynamoDB} = require("aws-sdk");

const fetchConfigValues = async (fieldName) => {
  const db = new DynamoDB.DocumentClient();
  const configValueTable = process.env.CONFIG_VALUES_TABLE;
  const queryParams = {
    TableName: configValueTable,
    Key: { value: fieldName },
  };

  try {
    const data = await db.get(queryParams).promise();
    return data.Item ? JSON.parse(data.Item.data) : null;
  } catch (error) {
    // console.log(`Error fetching config values for ${fieldName}:`, JSON.stringify(error));
    return null;
  }
};

module.exports.hello = async (event) => {


  const pizzaPackSkuOrder = await fetchConfigValues('pizzaPackSkuOrder') 

  const comboSkus = await fetchConfigValues('comboSkus') 

  const gb = await fetchConfigValues('ghostBins');
  const  ghostBins =  new Set(gb)

  console.log('pizzaPackSkuOrder', pizzaPackSkuOrder)
  console.log('comboSkus', comboSkus)
  console.log('ghostBins', ghostBins)

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        pizzaPackSkuOrder,
        comboSkus,
        ghostBins
      }),
    }
};
