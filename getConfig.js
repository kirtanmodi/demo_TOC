const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context) => {
  try {
    // Get the fieldName from the input event
    const { fieldName } = JSON.parse(event.body);

    // Check if the fieldName exists in the request
    if (!fieldName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing fieldName in the request.' }),
      };
    }

    // Fetch the config value based on the fieldName
    const configValue = await fetchConfigValue(fieldName);

    // If the config value is found, return it
    if (configValue) {
      return {
        statusCode: 200,
        body: JSON.stringify({ value: configValue }),
      };
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: `Config value for ${fieldName} not found.` }),
      };
    }
  } catch (error) {
    console.error('Error fetching config value:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error.' }),
    };
  }
};

const fetchConfigValue = async (fieldName) => {
  const queryParams = {
    TableName: process.env.CONFIG_VALUES_TABLE,
    Key: { id: fieldName },
  };

  const data = await docClient.get(queryParams).promise();
  return data.Item ? data.Item.data : null;
};
